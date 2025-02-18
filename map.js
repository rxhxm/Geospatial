// Set Mapbox access token
mapboxgl.accessToken =
  'pk.eyJ1Ijoicm9oYW0tbWVoIiwiYSI6ImNtNzlpcms0NDA1aWwybnB1dm04Y3RnOHoifQ.G0VaMaxAPsoO3lY3UCi88g';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the empty div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

// Wait until the map loads before adding sources, layers, and external data
map.on('load', () => {
  // Append the SVG overlay to the empty map container.
  const svg = d3
    .select('#map')
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%');

  // ----------------------------
  // Helper: Convert station coordinates (assumes keys "lat" and "lon")
  // ----------------------------
  function getCoords(station) {
    const lat = parseFloat(station.lat);
    const lng = parseFloat(station.lon);
    if (isNaN(lat) || isNaN(lng)) {
      console.warn('Invalid coordinates for station:', station);
      return { cx: 0, cy: 0 };
    }
    const point = new mapboxgl.LngLat(lng, lat);
    const pos = map.project(point);
    return { cx: pos.x, cy: pos.y };
  }

  // ----------------------------
  // Add Boston Bike Lanes
  // ----------------------------
  map.addSource('boston_route', {
    type: 'geojson',
    data:
      'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'blue',
      'line-width': 3,
      'line-opacity': 0.6
    }
  });

  // ----------------------------
  // Add Bluebikes Stations
  // ----------------------------
  const bluebikesUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  let stations = []; // Will hold the stations JSON data
  let circles;       // Will hold the D3 selection for station markers

  d3.json(bluebikesUrl)
    .then(jsonData => {
      console.log('Loaded JSON Data:', jsonData);
      stations = jsonData.data.stations;
      console.log('Stations Array:', stations);

      // Bind station data to circles
      circles = svg
        .selectAll('circle')
        .data(stations, d => d.short_name) // Using short_name as key; adjust if needed
        .enter()
        .append('circle')
        .attr('r', 5)
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .attr('pointer-events', 'auto'); // Enable pointer events for tooltips

      // Add initial tooltips (traffic data not available yet so default to zero)
      circles.each(function (d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic ?? 0} trips (0 departures, 0 arrivals)`);
      });

      // Function to update marker positions on the map
      function updatePositions() {
        circles.attr('cx', d => getCoords(d).cx)
               .attr('cy', d => getCoords(d).cy);
        if (stations.length > 0) {
          console.log('First station pixel coordinates:', getCoords(stations[0]));
        }
      }
      updatePositions();
      map.on('move', updatePositions);
      map.on('zoom', updatePositions);
      map.on('resize', updatePositions);
      map.on('moveend', updatePositions);
    })
    .catch(error => {
      console.error('Error loading JSON:', error);
    });

  // ----------------------------
  // Add Cambridge Bike Lanes
  // ----------------------------
  map.addSource('cambridge_route', {
    type: 'geojson',
    data:
      'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'red',
      'line-width': 3,
      'line-opacity': 0.6
    }
  });

  // ----------------------------
  // Filtering Variables & Time Filter Defaults
  // ----------------------------
  let timeFilter = -1; // -1 means no time filtering by default

  // These variables will hold our trips data and corresponding filtered versions.
  let tripsGlobal = [];
  let filteredTrips = [];
  let filteredArrivals = new Map();
  let filteredDepartures = new Map();
  let filteredStations = [];

  // ----------------------------
  // Load and Process Traffic (Trips) Data
  // ----------------------------
  d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv')
    .then(trips => {
      console.log('Traffic data loaded. Number of trips:', trips.length);

      // Convert time strings to Date objects for easier comparison.
      trips.forEach(trip => {
        // CSV field names: "started_at" and "ended_at"
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
      });

      tripsGlobal = trips; // Save full trip data.
      filterTripsByTime(); // Run initial filtering.
    })
    .catch(error => {
      console.error('Error loading traffic data:', error);
    });

  // ----------------------------
  // Helper: Convert a Date to Minutes Since Midnight
  // ----------------------------
  function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  // ----------------------------
  // Step 6.1: Define Quantize Scale for Traffic Flow
  // ----------------------------
  // This scale maps the ratio [0, 1] to one of three discrete values: 0, 0.5, or 1.
  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  // ----------------------------
  // Filtering Function: Update Filtered Data & Markers
  // ----------------------------
  function filterTripsByTime() {
    // Filter trips: if timeFilter is -1, no filtering.
    filteredTrips =
      timeFilter === -1
        ? tripsGlobal
        : tripsGlobal.filter(trip => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);
            return (
              Math.abs(startedMinutes - timeFilter) <= 60 ||
              Math.abs(endedMinutes - timeFilter) <= 60
            );
          });

    // Recalculate departures and arrivals from the filtered trips.
    filteredDepartures = d3.rollup(
      filteredTrips,
      v => v.length,
      d => d.start_station_id
    );
    filteredArrivals = d3.rollup(
      filteredTrips,
      v => v.length,
      d => d.end_station_id
    );

    // Create a new stations array with updated traffic numbers (clone each station first).
    filteredStations = stations.map(station => {
      let s = { ...station };
      let id = station.short_name; // Adjust if your keys differ.
      s.departures = filteredDepartures.get(id) ?? 0;
      s.arrivals = filteredArrivals.get(id) ?? 0;
      s.totalTraffic = s.departures + s.arrivals;
      return s;
    });

    console.log('Filtered stations:', filteredStations);

    // ----------------------------
    // Step 6.1: Update Marker Sizes and Colors Based on Filtered Data
    // ----------------------------
    // Use a square root scale for circle size. Make the range conditional:
    // when no filter is active: [0, 25]; when filtering: [3, 50].
    const maxTraffic = d3.max(filteredStations, d => d.totalTraffic);
    const radiusRange = timeFilter === -1 ? [0, 25] : [3, 50];
    const radiusScale = d3.scaleSqrt().domain([0, maxTraffic]).range(radiusRange);

    // Bind the new filteredStations data to our circles (keyed by short_name).
    svg
      .selectAll('circle')
      .data(filteredStations, d => d.short_name)
      .transition()
      .duration(500)
      .attr('r', d => radiusScale(d.totalTraffic))
      // Set a custom CSS variable based on the departure ratio mapped through stationFlow.
      .style('--departure-ratio', d => {
        return d.totalTraffic === 0 ? 0 : stationFlow(d.departures / d.totalTraffic);
      })
      .each(function (d) {
        // Update the tooltip text with current traffic values.
        d3.select(this).select('title').remove();
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });
  }

  // ----------------------------
  // Step 5.2: Reactivity – Update the Time Filter Display & Trigger Filtering
  // ----------------------------
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    filterTripsByTime();
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});