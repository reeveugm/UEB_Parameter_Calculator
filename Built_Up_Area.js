//DEFINISIKAN WILAYAH
// Batas Administratif Daerah Istimewa Yogyakarta
var gaulLevel1 = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level1");
var DIY = gaulLevel1.filter(ee.Filter.or(
  ee.Filter.eq('ADM1_NAME', 'Daerah Istimewa Yogyakarta')
));
Map.addLayer(DIY, {color: 'purple'}, 'Batasan DIY');

// Daerah Administratif Kota Madya Yogyakarta
var gaulLevel2 = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2");
var yogyakarta = gaulLevel2.filter(ee.Filter.or(
  ee.Filter.eq('ADM2_NAME', 'Kota Yogyakarta')
));
Map.addLayer(yogyakarta, {color: 'blue'}, 'Batasan Kodya Yogyakarta');

// Perkiraan Area Urban Yogyakarta
var geometry = ee.Geometry.Polygon([
  [
    [110.32394185087004, -7.84487934177259],
    [110.43084549576430, -7.84487934177259],
    [110.43084549576430, -7.73797569687831],
    [110.32394185087004, -7.73797569687831],
    [110.32394185087004, -7.84487934177259]
  ]
]);



//VISUALISASI DATA AREA TERBANGAUN
// Peta Bangunan berdasarkan waktu terbangunya 
// Terbatas dari 1975 hingga tahun 2015
// Resolusi 38 meter
var databu1 = ee.Image('JRC/GHSL/P2016/BUILT_LDSMT_GLOBE_V1');
var builtUp1 = databu1.select('built');
var builtUp1DIY = builtUp1.clip(DIY);
var setParam1 = {
  min: 1.0,
  max: 6.0,
  palette: ['0c1d60', '000000', '448564', '70daa4', '83ffbf', 'ffffff'],
};
Map.addLayer(builtUp1DIY, setParam1, 'Terbangun 1 Multitemporal');

// Peta Bangunan berdasarkan waktu terbangunya (Lebih terbaru namun resolusi rendah)
//Dataset ini berbentuk raster 
//Tentang distribusi permukaan terbangun dalam satuan meter persegi per sel grid 1000 meter.
//Informasi mencakup Luas permukaan bangunan
//Data ini tersedia dari tahun 1975 hingga 2030 dengan interval 5 tahun.
var databu2 = ee.Image("JRC/GHSL/P2023A/GHS_SMOD/2030").clip(DIY);
var builtUp2DIY = databu2.select('smod_code');
var setParam2 = {
  min: 0.0,
  max: 30.0,
  palette: ['000000', '200000', '70daa4', 'ffffff'],
};
Map.addLayer(builtUp2DIY, setParam2, 'Terbangun 2 Multitemporal');

// Peta Bangunan World Settlement Footprint (WSF) 2015 
//resolusi 10 meter tentang cakupan permukiman manusia
//multitemporal 2014–2015
var dataWSDIY = ee.Image("DLR/WSF/WSF2015/v1").clip(DIY);
var blackBackground = ee.Image(1);
var setParam3 = {
  min: 0,
  max: 255,
};
Map.addLayer(dataWSDIY, setParam3, "Area Tinggal Manusia DIY");

Map.centerObject(DIY, 11);


// Load citra built-up GHSL tahun 1975 dan 2020
var image_1975 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/1975');
var built_1975 = image_1975.select('built_surface');

var image_2020 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2020');
var built_2020 = image_2020.select('built_surface');

// Parameter visualisasi
var visParams = {min: 0.0, max: 8000.0, palette: ['000000', 'FFFFFF']};

// Kliping citra dengan geometry
var built_1975_clip = built_1975.clip(DIY);
var built_2020_clip = built_2020.clip(DIY);

// Menambahkan layer ke peta
Map.addLayer(built_1975_clip, visParams, 'Built-up surface [m2], 1975');
Map.addLayer(built_2020_clip, visParams, 'Built-up surface [m2], 2020');
Map.addLayer(geometry, {color: 'red'}, 'Urban DIY');


var image = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_C/2018");
var built = image.select('built_characteristics');

// Klip image ke geometry
var built_clip = built.clip(geometry);

// Tampilkan layer hasil klip
Map.addLayer(built_clip, {}, 'Settlement Characteristics (2018) - Clipped');
