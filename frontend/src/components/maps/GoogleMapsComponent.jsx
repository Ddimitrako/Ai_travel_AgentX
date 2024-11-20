// components/GoogleMapComponent.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
  height: '400px',
};

// Default center in case geocoding fails
const defaultCenter = {
  lat: 37.4467,
    lng: 25.3289,
};

const GoogleMapComponent = ({ apiKey, location }) => {
  const mapRef = useRef(null); // Reference to the map instance
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [markerPosition, setMarkerPosition] = useState(defaultCenter);

  // Function to geocode the location using Google Maps Geocoding API
  const geocodeLocation = useCallback(
    async (locationName) => {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
            locationName
          )}&key=${apiKey}`
        );
        const data = await response.json();
        if (data.status === 'OK') {
          const { lat, lng } = data.results[0].geometry.location;
          return { lat, lng };
        } else {
          console.error('Geocoding error:', data.status);
          return null;
        }
      } catch (error) {
        console.error('Geocoding error:', error);
        return null;
      }
    },
    [apiKey]
  );

  // Function to handle map load and store the map instance
  const onLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  // Function to animate zoom out, pan, and zoom in
  const animateToNewCenter = useCallback(
    (newCenter) => {
      if (mapRef.current && newCenter) {
        const map = mapRef.current;

        // Step 1: Zoom out
       window.setTimeout(() => {

          map.setZoom(3); // Adjust final zoom level as needed
        }, 2000); // Wait 1 second before panning and zooming in

        // Step 2: After zooming out, pan to new center and zoom in
        window.setTimeout(() => {
          map.panTo(newCenter);
          map.setZoom(12); // Adjust final zoom level as needed
        }, 2000); // Wait 1 second before panning and zooming in

        // Update the marker position
        setMarkerPosition(newCenter);
      }
    },
    []
  );

  // useEffect to geocode the location when it changes
  useEffect(() => {
    if (location) {
      geocodeLocation(location).then((coords) => {
        if (coords) {
          animateToNewCenter(coords);
          setMapCenter(coords);
        } else {
          console.error('Failed to geocode location:', location);
        }
      });
    }
  }, [location, geocodeLocation, animateToNewCenter]);

  return (
    <LoadScript googleMapsApiKey={apiKey}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={mapCenter}
        zoom={4}
        onLoad={onLoad}
      >
        {/* Marker at the new center */}
        {markerPosition && <Marker position={markerPosition} />}
      </GoogleMap>
    </LoadScript>
  );
};

export default GoogleMapComponent;
