// 1. Definisikan geometri urban 
// can be changed
var geometry = ee.Geometry.Polygon([
  [
    [
      110.42015509529854,
      -7.844882690083777
    ],
    [
      110.43084554002705,
      -7.844882749869953
    ],
    [
      110.43084554002705,
      -7.834192023747342
    ],
    [
      110.42015509529854,
      -7.834192041632986
    ],
    [
      110.42015509529854,
      -7.844882690083777
    ]
  ]
]);





var geometryArea = geometry.area().divide(1000 * 1000);

// Print the area in square meters

Map.centerObject(geometry, 13);

// 2. Perhitungan Aspek Rasio Plan
// 2.1 Perhitungan Building Plan Area Index
// 2.1.1 Muat dataset VIDA untuk Indonesia
var vida = ee.FeatureCollection("projects/sat-io/open-datasets/VIDA_COMBINED/IDN");

// 2.1.2 Filter bangunan di area urban
var vidaUrban = vida.filterBounds(geometry);

// 2.1.3 Pisahkan berdasarkan sumber (Untuk menentukan juamlah bangunan yang tidak memiliki confidence)
var vidaGoogle = vidaUrban.filter(ee.Filter.eq('bf_source', 'google'));
var vidaMicrosoft = vidaUrban.filter(ee.Filter.eq('bf_source', 'microsoft'));

// 2.1.4. Hitung jumlah dan luas total dari bangunan2 dari masing-masing sumber data
var countGoogle = vidaGoogle.size();
var countMicrosoft = vidaMicrosoft.size();
var areaGoogle = vidaGoogle.aggregate_sum("area_in_meters");
var areaMicrosoft = vidaMicrosoft.aggregate_sum("area_in_meters");

// 2.1.5 Hitung jumlah dan luas total dari seluruh bangunan
var totalCount = countGoogle.add(countMicrosoft);
var totalAreaBuildings = ee.Number(areaGoogle).add(areaMicrosoft);

// 2.1.6 Hitung luas wilayah urban (geometry)
var areaUrban = geometry.area(); // hasil dalam m²

// 2.1.7 Hitung Plan Area Index (λp = total bangunan / total wilayah)
var lambdaP = totalAreaBuildings.divide(areaUrban);

// 2.1.8 Cetak Hasil
//print("🏢 Building Plan Area Index (λp):", lambdaP);

// 2.2 Perhitungan Vegetation Plan Area Index
// 2.2.1 Muat Data Sentinel 2
var sentinel2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                .filterDate('2023-01-01', '2023-12-31')
                .filterBounds(geometry)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
                .map(function(img) {
    return img.updateMask(img.select('QA60').not());
  });
// Ini untuk melihat jumlah citra yang dipakai
// print('Jumlah Citra Sentinel-2:', sentinel2.size());

// 2.2.2 Konstruksi variabel penghitung nilai MSAVI (Modified Soil Adjusted Vegetation Index)
var calculateMSAVI = function(image) {
  var nir = image.select('B8'); //NIR Near InfraRed
  var red = image.select('B4'); //Merah
  var msavi = nir.multiply(2).add(1)
    .subtract(
      nir.multiply(2).add(1).pow(2)
        .subtract(nir.subtract(red).multiply(8))
        .sqrt()
    )
    .divide(2)
    .rename('MSAVI');
  return msavi;
};

// 2.2.3 Penghitungan nilai MSAVI untuk citra2 yang diambil 
var msaviCollection = sentinel2.map(calculateMSAVI);

// 2.2.4 Mengambil nilai tengah dari MSAVI untuk setiap pixel dalam area geometry
var msaviComposite = msaviCollection.median().clip(geometry);

// 2.2.5 Mendefinisikan area pixel di seluruh bumi
var pixelArea = ee.Image.pixelArea();

// 2.2.6 Menghitung luas area pixel yang terdapat di dalam geometry (Kurang lebih sama dengan Luas Geografis Geometri)
var areaWithoutMask = pixelArea.rename('area') 
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: geometry,
    scale: 10,
    maxPixels: 1e9
  });
  
// 2.2.7 Mengambil persentil ke-5 dan ke-95 untuk menghitung FVC
//       penghitungan ini untuk menyesuaikan rentang MSAVI (-1 hingga +1) menjadi fraksional (0 - 1)
var pers = msaviComposite.reduceRegion({
  reducer: ee.Reducer.percentile([5, 95]),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e9
});

// 2.2.8 Mengambil nilai P5 sebagai batas vegetasi, P95 sebagai batas vegetasi penuh
var soilP5 = ee.Number(pers.get('MSAVI_p5'));
var vegP95 = ee.Number(pers.get('MSAVI_p95'));

// 2.2.9 Hitung FVC dengan nilai MSAVI_pix dari msaviComposite
//       FVC = (Mpix-Msoil)/(Mveg-Msoil)
var fvcPerc = msaviComposite
  .subtract(soilP5)
  .divide(vegP95.subtract(soilP5))
  .clamp(0, 1)
  .rename('FVC_MSAVI_Perc');

// 2.2.10 Menghitung besar luasan area tervegetasi di masing2 pixel
var weightedFvcPerc = fvcPerc.multiply(pixelArea.updateMask(fvcPerc));

// 2.2.11 Menghitung total luasan area yang tervegetasi di keseluruhan pixel
var totalWeightedFvcPerc = weightedFvcPerc.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e9
});

// 2.2.12 Menghitung nilai PAI veg dengan membagi luas area pixel vegetasi dibagi luas area pixel keseluruhan di geometri
var lambdaF = ee.Number(totalWeightedFvcPerc.get('FVC_MSAVI_Perc'))
                     .divide(ee.Number(areaWithoutMask.get('area')));

// 2.2.13 Cetak hasil perhitungan 
//print('🌿 Vegetaion Plan Area Index (λf):', lambdaF);

// 2.3 Perhitungan Water Plan Area Index
// 2.3.1 Hitung MNDWI (Modified Normalized Difference Water Index) 
//       dari band Hijau(B3) dan Shortwave Infrared (B11)
var addMNDWI = function(image) {
  var mndwi = image.normalizedDifference(['B3', 'B11']).rename('MNDWI');
  return image.addBands(mndwi);
};
// 2.3.2 Membuat composite dari citra2 yang diambil dan dipotong untuk geometri
var mndwiComposite = sentinel2
  .map(addMNDWI)
  .select('MNDWI')
  .median()
  .clip(geometry);

// 2.3.3 Buat masking yang hanya menampilkan area yang terdapat air
var waterMask = mndwiComposite.gt(0).rename('waterMask');

// 2.3.4 Menghitung luas total area 
var totalArea = pixelArea
  .rename('area')
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: geometry,
    scale: 10,
    maxPixels: 1e9
  })
  .getNumber('area');

// 2.3.5 Menghitung luas total area yang tertutup oleh air
var totalWaterArea = waterMask
  .multiply(pixelArea)
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: geometry,
    scale: 10,
    maxPixels: 1e9
  })
  .getNumber('waterMask');

// 2.3.6 Menghitung Water Plan Area Index
var lambdaW = totalWaterArea.divide(totalArea);

// 2.3.7 Mencentak hasil ke konsol
//print('🌊 Water Plan Area Index (λw):', lambdaW);

// 2.4 Perhitungan Impervious Plan Area Index
// 2.4.1 Masking awan & cirrus menggunakan bit QA60 Sentinel-2
function maskClouds(img) {
  var qa = img.select('QA60');
  // bit 10 = awan, bit 11 = cirrus
  var mask = qa.bitwiseAnd(1 << 10).eq(0)
           .and(qa.bitwiseAnd(1 << 11).eq(0));
  return img.updateMask(mask);
}
var s2Clean = sentinel2.map(maskClouds);

// 2.4.2 Komposit median dari citra Sentinel-2 yang sudah bersih awan
var median = s2Clean.median().clip(geometry);

// 2.4.3 Buat masker area non-vegetasi dari citra fraksi vegetasi (fvcPerc)
var nonVegMask = fvcPerc.lt(0.35);  // threshold NDVI < 0.35 dianggap non-vegetasi

// 2.4.4 Hitung NDBI dan ekstraksi piksel impervious
var ndbi = median.normalizedDifference(['B11', 'B8']).rename('NDBI');
var impervMask = ndbi
  .gte(0)                        // hanya piksel NDBI ≥ 0 (indikasi permukaan keras)
  .updateMask(nonVegMask)       // hilangkan area vegetasi
  .rename('impervMask');

// 2.4.5 Buat citra raster mask bangunan dari geometri VIDA
var buildingMask = ee.Image.constant(0)    // mulai dari image all-zeros
  .byte()
  .paint({
    featureCollection: vidaUrban,
    color: 1
  })
  .rename('buildingMask')
  .clip(geometry)
  .unmask(0); 

// 2.4.6 Buang piksel impervious yang berhimpit dengan bangunan
var impervNoBuild = impervMask
  .updateMask(buildingMask.eq(0))   // hanya piksel impervious yang bukan bangunan
  .rename('impervNoBuild');

// 2.4.7 Hitung total luas permukaan impervious non-bangunan (dalam m²)
var impervAreaSum = impervNoBuild
  .multiply(ee.Image.pixelArea())
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: geometry,
    scale: 10,
    maxPixels: 1e13
  })
  .get('impervNoBuild');

// 2.4.8 Hitung Impervious Plan Area Index (λi = impervious / total area)
var lambdaI = ee.Number(impervAreaSum).divide(totalArea);

// 2.4.9 Cetak hasil ke konsol
//print('🛣️ Impervious Plan Area Index (λi):', lambdaI);

// 2.5 Perhitungan Bare Soil Plan Area Index 
//     Nilai aspek rasio harus 1 saat ditotalkan, sehingga bare soil dapat diasumsikan
//     residu dari fraksi yang lain
var lambdaS = ee.Number(1)
  .subtract(lambdaP.add(lambdaI).add(lambdaF).add(lambdaW));
//print('🏜️ Bare Soil Plan Area Index (λs):', lambdaS);

// 3. Perhitungan Tinggi Elemen Urban
// 3.1 Perhitungan Tinggi Bangunan Rata-Rata (m)
// 3.1.1 Muat data Global Human Settlement Building Height tahun 2018 (Terbaru yang mendekati 2023)
var image = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_H/2018");
var built = image.select('built_height');

// 3.1.2 Hitung Rata2 tinggi bangunan untuk area yang di geometri
var stats = built.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: geometry,
  scale: 30, // Resolusi spasial
  maxPixels: 1e9
});

// 3.1.3 Cetak hasil ke konsol
//print('🏙️ Rata-rata tinggi bangunan (m):', stats.get('built_height'));

// 3.2 Perhitungan Tinggi Vegetasi Rata-Rata (m)
// 3.2.1 Memuat data DSM (Digital Surface Model) dan DTM (Digital Terrain Model)
var dsmAlos = ee.ImageCollection("JAXA/ALOS/AW3D30/V3_2")
  .filterBounds(geometry)
  .select("DSM")
  .mosaic()
  .clip(geometry);
var dtmGMTED = ee.Image("USGS/GMTED2010_FULL")
  .select("min")
  .clip(geometry);
  
// 3.2.3 Hitung perbedaan tinggi antara DSM dengan DTM
var height = dsmAlos
  .subtract(dtmGMTED)
  .max(0)             // pastikan tidak negatif
  .rename("Height");

// 3.2.4 Membuat masking untuk area yang hanya punya vegetasi dengan nilai lambdaF besar dari 0.05 (untuk mengabaikan rumput)
var vegMask = fvcPerc.gt(0.05);

// 3.2.5 Terapkan mask ke height → hanya tinggi di piksel vegetasi yang dihitung
var heightVeg = height.updateMask(vegMask);

// 3.2.6 Hitung rata-rata tinggi vegetasi hanya dari pixel bervegetasi
var meanH_Veg = heightVeg.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: geometry,
  scale: 30,      // samakan dengan resolusi DTM/GMTED
  maxPixels: 1e9
}).get("Height");

// 3.2.7 Cetak mean height vegetasi
//print('🌳 Rata-rata tinggi vegetasi (m):', meanH_Veg);

// 4 Perhitungan Frontal Area Index
// 4.1 Building Frontal Area Index
//   Untuk pendekatan Kanda et al di SUMM dan penyederhanaan untuk SUEWS bangunan dianggap Kubus
//   dan sisi frontal adalah luas sisi depan dari kubus yang mana sama dengan sisi atapnya 
//   sehingga PAI = FAI
//print("🧱 Building Frontal Area Index (λfb):", lambdaP);

// 4.2 Vegetation Frontal Area Index
// 4.2.1 Misal sudah ada fvcPerc (unitless) dan pixelArea (m2) dan height (m) dan C
//       Pendekatan yang digunakan untuk frontal adalah mencari sisi tegaknya saja untuk semua wilayah.
//       Vegetasi dalam sebuah pixel dianggap balok dengan alas persegi
//       Jika vegetation plan area adalah luas alasnya, salah satu sisinya adalah akar dari luas tersebut
//       Sisi tersebut dikalikan dengan tinggi balok (vegetasi) dan diberikan koreksi untuk celah2 yang terdapat pada vegetasi
var frontalAreaRaster = pixelArea
  .multiply(fvcPerc)           // FVC * pixelArea → area tutupan (m2)
  .sqrt()                      // → lebar s (m)
  .multiply(heightVeg)         // → A_fpiksel = s × H (m2)
  .multiply(0.8)               // koreksi bentuk untuk angin yang dapat melewati pohon
  .rename('frontalArea');

// 4.2.2 Jumlahkan frontal area vegetasi di seluruh geometry
var totalFrontal = frontalAreaRaster.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e9
}).get('frontalArea');

// 4.2.3 Hitung frontal area index
var fai = ee.Number(totalFrontal).divide(totalArea);

// 4.2.4 Cetak nilai
//print('🍃 Vegetation Frontal Area Index (λfv):', fai);

// 5 Perhitungan Orientasi Ngarai Perkotaan (Azimuth Jalan) (deg)
// 5.1 Muat data jalan major (utama/highway) untuk praktikalitas yang berasal dari OpenStreetMap
var roads = ee.FeatureCollection('projects/ee-arifrm/assets/urbanMajorRoadsDIY')
  .filterBounds(geometry);

// 5.2 Membuat variabel penghitung sudut azimuth dari jalan dan sesuaikan agar berada semua berada di rentang +0 hingga +180
//     Ini untuk menyederhanakan perhitungan sudut terhadap satu sumbu acuan (arah utara)
//     Hitung juga panjang dari masing2 jalan
var calculateAzimuthAndLength = function(feature) {
  var line = feature.geometry().coordinates();
  
  // Memastikan garis jalan adalah 2D dan mengambil titik paling awal dan akhir
  var start = ee.List(line.get(0));
  var end = ee.List(line.get(line.length().subtract(1)));
 
  // Hitung perbedaan jarak titik (panjang jalan)
  var dx = ee.Number(end.get(0)).subtract(ee.Number(start.get(0))); // Δ longitude
  var dy = ee.Number(end.get(1)).subtract(ee.Number(start.get(1))); // Δ latitude
  
  // Hitung Azimuth Keseluruhan
    var azimuth = dy.atan2(dx)
    .multiply(180 / Math.PI)  // Convert to degrees
    .add(360)                 // Ensure positive (0-360)
    .mod(360);                // Normalize to range 0-360
 
  // Sesuakan agar ada di rentang 0° to 180°
  // (0°-45°= Utara-Timur Laut, Barat Daya-Selatan;
  //  45°-135°= Timur Laut-Timur-Tenggara, Barat Laut-Barat-Barat Daya;
  //  135°-180°= Tenggara-Selatan, Barat Laut-Utara)
  var azimuthNormalized = azimuth;
  azimuthNormalized = ee.Algorithms.If(azimuth.gt(180), azimuth.subtract(180), azimuthNormalized);

  var length = feature.geometry().length(); // meters

  return feature.set({
    'azimuthNormalized': azimuthNormalized,
    'length': length
  }); 
};

// 5.3 Gunakan variabel penghitung tadi ke dataset jalan yang sudah dimuat sebelumnya
var roadsWithAziLenght = roads.map(calculateAzimuthAndLength);

// 5.4 Mengurutkan nilai panjang jalan dan mbil nilai panjang terpendek sebagai syarat minimal perwakilan azimuth
var sortedRoads = roadsWithAziLenght.sort('length');
var shortestRoad = sortedRoads.first();
var shortestLength= ee.Number(shortestRoad.get('length'));

// 5.5 Buat variabel pengelompok jalan membujur(vertikal) dan melintang(horizontal)
//     Fokus perhitungan orientasi jalan hanya pada jalan vertikal (membujur bumi)
//     Ini dimaksudkan untuk penyederhanaan bentuk ngarai dengan pendekatan
//     jalan melintang bumi 90 derajat terhadap jalan membujur bumi
//     Sehingga perhitungan azimuth hanya diperuntukan untuk jalan membujur
var classifyRoads = function(feature) {
  var azimuth = ee.Number(feature.get('azimuthNormalized'));  // Ambil nilai azimuth yang sudah dinormalisasi

  // Pastikan azimuth berada dalam rentang 0-180, jika tidak, atur ke nilai dalam rentang tersebut
  azimuth = azimuth.max(0).min(180); // Nilai azimuth harus di antara 0 dan 180

  // Cek apakah azimuth valid (lebih besar dari 0 dan lebih kecil dari 180)
  var classification = ee.Algorithms.If(
    azimuth.lt(45).or(azimuth.gte(135)),  // Cek apakah azimuth dalam rentang 0-45 atau 135-180
    'Vertical',  // Jika ya, maka jalan vertikal
    ee.Algorithms.If(
      azimuth.gte(45).and(azimuth.lt(135)),  // Cek apakah azimuth dalam rentang 45-135
      'Horizontal',  // Jika ya, maka jalan horizontal
      'Unknown'  // Jika tidak, beri label 'Unknown'
    )
  );

  return feature.set('classification', classification);  // Tambahkan hasil klasifikasi ke dalam fitur
};
// 5.6 Filter jalan yang memiliki nilai azimuth tidak null
var filteredRoads = roadsWithAziLenght.filter(ee.Filter.notNull(['azimuthNormalized']));

// 5.7 Terapkan var klasifikasi ke daftar jalan yang sudah di filter
var classifiedRoads = filteredRoads.map(classifyRoads);

// 5.8 Ambil hanya jalan yang diklasifikasikan vertikal atau membujur
var verticalRoads = classifiedRoads.filter(ee.Filter.eq('classification', 'Vertical'));

// 5.9 Hitung jumlah perwakilan azimuth untuk setiap jalan 
//     dengan mereplikasi nilai azimuth sebanyak perbandingan panjang jalan
//     terhadap jalan terpendek
var repeatedAzimuths = verticalRoads.iterate(function(f, list) {
  f    = ee.Feature(f);
  list = ee.List(list);
  var az  = f.getNumber('azimuthNormalized');
  var len = f.getNumber('length');
  var reps= len.divide(shortestLength).ceil();
  // ulangi 'az' sebanyak 'reps'
  var azList = ee.List.repeat(az, reps);
  return list.cat(azList);
}, ee.List([]));
repeatedAzimuths = ee.List(repeatedAzimuths);

// 5.10 Mengubah List perwakilan azimuth menjadi kumpulan fitur untuk dibuat histogram
var repeatedFC = ee.FeatureCollection(
  repeatedAzimuths.map(function(val) {
    return ee.Feature(null, {az: val});
  })
);

var histDict = ee.Dictionary(repeatedFC.aggregate_histogram('az'));

// 5.11 Membuat daftar kamus dengan pasangan key dan value untuk masing2 azimuth
var keys    = histDict.keys();
var entries = keys.map(function(k) {
  return ee.Dictionary({key: k, value: histDict.get(k)});
});
var entriesList = ee.List(entries);
var valuesList  = entriesList.map(function(e) {
  return ee.Dictionary(e).get('value');
});

// 5.12 Mengurutkan nilai-nilai berdasarkan keseringan kemunculannya 
//      dengan nilai yang paling akhir adalah nilai yang paing sering muncul
var sortedEntries = entriesList.sort(ee.List(valuesList));
var modusEntry    = ee.Dictionary(sortedEntries.get(sortedEntries.size().subtract(1)));

// 5.13 Mengambil nilai yang paling sering muncul atau modus dari keseluruhan data
var azModus       = ee.Number.parse(modusEntry.get('key'));

// 5.14 Cetak hasil orientasi sudut di consol
//print('🧭 Azimuth dominan (deg):', azModus);

// 6 Perhitungan Kelembaban Tanah, Presipitasi, dan Musim Pra Simulasi (%)
// 6.1 Penyesuaian dengan resolusi dataset, titik di geometri diperluas sejauh 15 km
var bufferedAOI = geometry.buffer(15000);

// 6.2 Muat data kelembaban tanah, menetapkan tanggal citra, dan mengaplikasikan ke area tersangga
var soilMoist = ee.ImageCollection('NASA/SMAP/SPL3SMP_E/005')
  .filterBounds(bufferedAOI)
  .filterDate('2022-12-01', '2022-12-31')
  // masking longgar: terima flag 0 & 1
  .map(function(img){
    return img.select('soil_moisture_am')
              .updateMask(img.select('retrieval_qual_flag_am').lte(1));
  })
  .mean()        // rata‐rata harian
  .multiply(100) // ubah ke persen
  .rename('sm_pct');

// 6.3 Menghitung rata rata kelembaban tanah pada daerah tersangga
var soilVal = soilMoist.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: bufferedAOI,
  scale: 10000,
  maxPixels: 1e8
}).get('sm_pct');

// 6.4 Mencetak nilai di konsol
//print('💦 Rata2 Kelembaban Tanah Pra-Simulasi (%)', soilVal);

// 6.5 Muat dataset citra presitpitasi dan dan menjumlahkan semua image harian daalam satu layer 
//     Didapat presipitasi tiap pixel
var precip = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterBounds(bufferedAOI)
  .filterDate('2022-12-01', '2022-12-31')
  .select('precipitation')
  .sum();  // jumlah kumulatif sepanjang bulan

// 6.6 Menjumlahakn presipitasi di seluruh wilayah of interest 
var precipVal = precip.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: bufferedAOI,
  scale: 10000,
  maxPixels: 1e8
}).get('precipitation');

// 6.7 Cetak hasil presipitasi total
//print('🌧️ Total Precipitation Pra-Simulasi (mm):', precipVal);

// 6.8 Fungsi pengklasifikasian musim berdasarkan tanggal dan lokasi
var getSeason = function(date, lat) {
  var m = ee.Date(date).get('month');
  var south = ee.Number(lat).lt(0);
  return ee.String(
    ee.Algorithms.If(
      m.eq(12).or(m.lte(2)),
      ee.Algorithms.If(south, 'Summer', 'Winter'),
      ee.Algorithms.If(
        m.lte(5),
        ee.Algorithms.If(south, 'Autumn', 'Spring'),
        ee.Algorithms.If(
          m.lte(8),
          ee.Algorithms.If(south, 'Winter', 'Summer'),
          ee.Algorithms.If(south, 'Spring', 'Autumn')
        )
      )
    )
  );
};
//print('🌅 Musim Pra-Simulasi @ lat -7.8:', getSeason('2022-12-15', -7.8));

// 7 Perhitungan Kepadatan Populasi (orang/hektare)
// 7.1 Muat dataset 
var dataset2020 = ee.ImageCollection('CIESIN/GPWv411/GPW_Population_Density')
                     .filterDate('2020-01-01', '2021-01-01')
                     .first();
var raster2020 = dataset2020.select('population_density');

// 7.2 Menyiapkan tampilan peta (warna dan rentang nilai)
var raster_vis = {
  'max': 1000.0,
  'palette': [
    'ffffe7',
    'FFc869',
    'ffac1d',
    'e17735',
    'f2552c',
    '9f0c21'
  ],
  'min': 200.0
};


// 7.3 Masking data populasi degang geometri
var population_density_in_aoi = raster.clip(geometry);

// 7.4 Konversi satuan dari orang per km2 ke orang per hektarConvert population density from people per km² to people per hectare
var population_per_hectare = population_density_in_aoi.divide(100);  // 1 km² = 100 ha

// 7.5 Menghitung jumlah total orang (dalam satuan jiwa/ha) di AOI
var area = geometry.area();  // Total area of the AOI in square meters
var total_population_per_hectare = population_per_hectare.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geometry,
  scale: 1000,  
  maxPixels: 1e8
});

// 7.6 Tampilkan langsung sebagai angka
//print('👥 Densitas Populasi (orang/ha):', total_population_per_hectare.get('population_density'));

// 8 Tampilkan Lat/Long (Lin/Bur) sentroid geometri
var centroid = geometry.centroid();
var lon = centroid.coordinates().get(0);
var lat = centroid.coordinates().get(1);
//print('🌐 Longitude (deg):', lon);
//print('🗺️ Latitude (deg):', lat);

print('Area (km^2) =', geometryArea);
print("---------------------");
print('Mean building Height (m):', stats.get('built_height'));
print("Frontal Building (λfb):", lambdaP);
print("Plan Building (λp):", lambdaP);
print("---------------------");
print('Mean veg Height (m):', meanH_Veg);
print('Frontal Veg (λfv):', fai);
print('Plan Veg (λf):', lambdaF);
print("---------------------");
print('Impervious/Paved (λi):', lambdaI);
print('Evergreen Tree(λf):', lambdaF);
print('Grass:', "0");
print('Water (λw):', lambdaW);
print("Building (λp):", lambdaP);
print('Deciduous Tree:', "0");
print('Bare (λs):', lambdaS);
print("---------------------");
print('Leaf Cycle:', getSeason('2022-12-15', -7.8));
print("---------------------");
print('Year:', "2023");
print('Latitude (deg):', lat);
print('Longitude (deg):', lon);
print('Population Density (people/ha):', total_population_per_hectare.get('population_density'));

// 9 Visualisasi Layer
/*

// 9.1 Area Urban yang ingin diamati
Map.addLayer(geometry, {color: 'gray'}, 'Urban Yogyakarta');
// 9.2 Geometri Bangunan (LambdaP)
Map.addLayer(vidaUrban, {color: 'yellow'}, 'Bangunan VIDA DIY');
//Map.addLayer(msaviComposite, {min: -1, max: 1, palette: ['white','pink', 'red', 'yellow', 'green']}, 'MSAVI Kota Yogyakarta');
// 9.3 Fractional Vegetation Cover (LambdaV)
Map.addLayer(
  fvcPerc,
  {min: 0, max: 1, palette: ['red', 'yellow', 'green']},
  'FVC(MSAVI)'
);
// 9.4 Water Plan Area Index
Map.addLayer(
  waterMask.updateMask(waterMask),
  {palette: ['blue']},
  'Water Mask'
);
// 9.5 Impervious Plan Area Index
Map.addLayer(impervNoBuild.selfMask(), {palette:['#bcc2cc']}, 'Impervious (no buildings)');
// 9.6 Rata2 Tinggi bangunan GHSL 2018
var visParams = {
  min: 0.0,
  max: 12.0,
  palette: ['000000', '0d0887', '7e03a8', 'cc4778', 'f89540', 'f0f921'],
};
Map.addLayer(built.clip(geometry), visParams, 'Average building height [m], 2018');
// 9.7 Jalan Utama Membujur dan Melintang
Map.addLayer(classifiedRoads.filter(ee.Filter.eq('classification', 'Vertical')), {color: 'blue'}, 'Jalan Vertikal');
Map.addLayer(classifiedRoads.filter(ee.Filter.eq('classification', 'Horizontal')), {color: 'red'}, 'Jalan Horizontal');
// 9.8 Garis Orientasi Ngarai
var azimuthAngle = azModus; 
var numberOfLines = 8;
var bounds = geometry.bounds();
var coords = bounds.coordinates().get(0); 
var sw = ee.List(coords).get(0); 
var ne = ee.List(coords).get(2);
var minLon = ee.Number(ee.List(sw).get(0));
var minLat = ee.Number(ee.List(sw).get(1));
var maxLon = ee.Number(ee.List(ne).get(0));
var maxLat = ee.Number(ee.List(ne).get(1));
var latStep = maxLat.subtract(minLat).divide(numberOfLines - 1);
var lonStep = maxLon.subtract(minLon).divide(numberOfLines - 1);
var createLine = function(startLon) {
  startLon = ee.Number(startLon);
  var startPoint = ee.Geometry.Point([startLon, minLat]);
  var angleRad = ee.Number(azimuthAngle).multiply(Math.PI).divide(180);
  var deltaLat = maxLat.subtract(minLat);
  var deltaLon = deltaLat.multiply(angleRad.tan());
  var endLon = startLon.add(deltaLon);
  endLon = ee.Number(endLon.min(maxLon));
  var endPoint = ee.Geometry.Point([endLon, maxLat]);
  return ee.Feature(ee.Geometry.LineString([startPoint, endPoint]));
};
var lines = ee.FeatureCollection(
  ee.List.sequence(minLon, maxLon, lonStep).map(createLine)
);
var clippedLines = lines.map(function(feature) {
  return feature.intersection(geometry, 0.1);
});
Map.addLayer(clippedLines, {color: 'purple'}, 'Garis Azimuth');
// 9.9 Visualisasi Kelembaban Citra Kelembaban Tanah
Map.addLayer(soilMoist.clip(geometry), {min: 0, max: 50, palette: ['blue', 'lime', 'white']}, 'Soil Moisture Masked (%)');
// 9.10 Citra Kepadatan Populasi
Map.addLayer(population_per_hectare, raster_vis, 'Population per Hectare');
*/

// 10 Catatan :
// 10.1 Perbarui tanggal citra
// 10.2 Perhatikan totalArea yang dipakai di aspek rasio, pastikan sama untuk akurasi
// 10.3 Vegetasi yang terhitung disini juga mengikutkan area agrikultur yang sulit dibedakan dengan vegetasi kanopik
// 10.4 Kelembaban Tanah, Densitas Populasi, dan Presipitasi mungkin kurang akurat. Coba pakai sumber ketiga
