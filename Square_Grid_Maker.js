var geometry = ee.Geometry.Polygon([
  [
    [110.32394185087004, -7.84487934177259],
    [110.43084549576430, -7.84487934177259],
    [110.43084549576430, -7.73797569687831],
    [110.32394185087004, -7.73797569687831],
    [110.32394185087004, -7.84487934177259]
  ]
]);

var areaMeter = geometry.area();

// Mengonversi luas ke kilometer persegi (1 km^2 = 1.000.000 m^2)
var areaKm = areaMeter.divide(1e6);

// Menampilkan hasil di console
print('Luas geometri dalam km persegi:', areaKm);

// Mengambil dua titik pada sisi atas (koordinat pertama dan kedua)
var point1 = ee.Geometry.Point([110.32394185087004, -7.84487934177259]);
var point2 = ee.Geometry.Point([110.43084549576430, -7.84487934177259]);

// Menghitung jarak antara dua titik pada sisi atas (dalam meter)
var distanceTop = point1.distance(point2);

// Mengambil dua titik pada sisi samping (koordinat kedua dan ketiga)
var point3 = ee.Geometry.Point([110.43084549576430, -7.73797569687831]);
var point4 = ee.Geometry.Point([110.32394185087004, -7.73797569687831]);

// Menghitung jarak antara dua titik pada sisi samping (dalam meter)
var distanceSide = point2.distance(point3);

// Jika ingin mengonversi ke kilometer, bagi dengan 1000
print('Panjang sisi atas (dalam kilometer):', distanceTop.divide(1000));
print('Panjang sisi samping (dalam kilometer):', distanceSide.divide(1000));


// 2. Ukuran grid target (~1.1 km²)
var cellSize = 0.0106402385197; // derajat

// 3. Batas geometry
var bounds = geometry.bounds();
var coords = ee.List(bounds.coordinates().get(0));

var west = ee.Number(ee.List(coords.get(0)).get(0));
var south = ee.Number(ee.List(coords.get(0)).get(1));
var east = ee.Number(ee.List(coords.get(2)).get(0));
var north = ee.Number(ee.List(coords.get(2)).get(1));

var width = east.subtract(west);
var height = north.subtract(south);

var numX = width.divide(cellSize).ceil(); // jumlah grid kolom
var numY = height.divide(cellSize).ceil(); // jumlah grid baris

// 4. Buat grid dengan penyesuaian batas kanan dan atas
var adjustedGrid = ee.FeatureCollection(
  ee.List.sequence(0, numY.subtract(1)).map(function(y) {
    return ee.List.sequence(0, numX.subtract(1)).map(function(x) {
      x = ee.Number(x);
      y = ee.Number(y);
      
      var xMin = west.add(x.multiply(cellSize));
      var xMax = ee.Algorithms.If(
        x.eq(numX.subtract(1)), // grid kolom terakhir
        east,                   // pas dengan batas timur
        xMin.add(cellSize)
      );

      var yMin = south.add(y.multiply(cellSize));
      var yMax = ee.Algorithms.If(
        y.eq(numY.subtract(1)), // grid baris terakhir
        north,                  // pas dengan batas utara
        yMin.add(cellSize)
      );
      
      var rect = ee.Geometry.Rectangle([xMin, yMin, xMax, yMax]);
      return ee.Feature(rect, {
        id: x.add(y.multiply(100))
      });
    });
  }).flatten()
);

// 5. Filter grid yang overlap geometry
var finalGrid = adjustedGrid.filterBounds(geometry);

// 6. Uji luas grid menggunakan proyeksi UTM
var utmProj = ee.Projection('EPSG:32749');
var sampleArea = ee.Feature(finalGrid.first())
  .geometry().transform(utmProj, 1)
  .area(1).divide(1e6);

// 7. Tampilkan
Map.centerObject(geometry, 13);
Map.addLayer(geometry, {color: 'blue'}, 'Geometry');
Map.addLayer(finalGrid, {color: 'red', fillOpacity: 0.4}, 'Adjusted Grid');

print('Jumlah Grid:', finalGrid.size());
print('Luas Salah Satu Grid (km²):', sampleArea);



