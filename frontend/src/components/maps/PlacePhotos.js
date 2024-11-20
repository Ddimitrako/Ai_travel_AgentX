// components/maps/PlacePhotos.js

import React, { useState, useEffect } from 'react';
import { Card, Box, Grid, Dialog, DialogContent, IconButton } from '@mui/material';
import { styled } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close'; // Close button icon for the modal

const StyledImage = styled('img')({
  width: '100%',
  height: '100%',
  borderRadius: '8px',
  objectFit: 'cover',
});

const PlacePhotos = ({ location }) => {
  const [photoUrls, setPhotoUrls] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    if (!location) return;

    const fetchPhotoUrls = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/place-photos?location=${encodeURIComponent(location)}`);
        const data = await response.json();

        if (data.photos && data.photos.length > 0) {
          setPhotoUrls(data.photos);
        } else {
          console.warn('No photos available for this location.');
          setPhotoUrls([]);
        }
      } catch (error) {
        console.error('Error fetching place photos:', error);
      }
    };

    fetchPhotoUrls();
  }, [location]);

  // Open the modal and set the selected photo
  const handleClickOpen = (photoUrl) => {
    setSelectedPhoto(photoUrl);
    setOpen(true);
  };

  // Close the modal
  const handleClose = () => {
    setOpen(false);
    setSelectedPhoto(null);
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
      {photoUrls.length > 0 ? (
        <Grid container spacing={2}>
          {/* Display all images with the same size */}
          {photoUrls.slice(0, 8).map((photoUrl, index) => (
            <Grid item xs={12} sm={6} md={3} key={index}>
              <Card sx={{ height: 150, cursor: 'pointer' }} onClick={() => handleClickOpen(photoUrl)}>
                <StyledImage src={photoUrl} alt={`Photo ${index + 1} of ${location}`} />
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
          No photos available for this location.
        </Box>
      )}

      {/* Modal for displaying the selected photo */}
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogContent sx={{ position: 'relative', p: 0 }}>
          <IconButton
            onClick={handleClose}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              color: 'white',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.7)' },
            }}
          >
            <CloseIcon />
          </IconButton>
          {selectedPhoto && (
            <img
              src={selectedPhoto}
              alt="Selected"
              style={{
                width: '100%',
                height: 'auto',
                borderRadius: '8px',
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default PlacePhotos;
