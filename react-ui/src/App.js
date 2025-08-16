import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './styles.css';

function App() {
  const [urlConfig, setUrlConfig] = useState([]);
  const [pollInterval, setPollInterval] = useState(60);
  const [newLatitude, setNewLatitude] = useState('');
  const [newLongitude, setNewLongitude] = useState('');
  const [newName, setNewName] = useState('');
  const [imageConfig, setImageConfig] = useState([]);
  const [imagePollInterval, setImagePollInterval] = useState(1800);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageName, setNewImageName] = useState('');
  const [enableArkansasBurnBan, setEnableArkansasBurnBan] = useState(false);

  // Fetch the current configuration when the component loads
  useEffect(() => {
    axios.get('/api/config')
      .then(response => {
        setUrlConfig(response.data.urlConfig);
        setPollInterval(response.data.pollInterval / 1000);
        setImageConfig(response.data.imageConfig || []);
        setImagePollInterval((response.data.imagePollInterval || 1800000) / 1000);
        setEnableArkansasBurnBan(response.data.enableArkansasBurnBan || false);
      })
      .catch(error => console.error('Error fetching config:', error));
  }, []);

  // Handle manual refresh
  const handleRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/refresh', {})
      .catch(error => console.error('Error refreshing data:', error));
  };

  // Handle adding a new location
  const handleSubmit = (e) => {
    e.preventDefault();
    axios.post('/api/config', {
      latitude: newLatitude,
      longitude: newLongitude,
      name: newName,
      pollInterval: pollInterval * 1000
    })
    .then(response => {
      setUrlConfig(response.data.urlConfig);
      setNewLatitude('');
      setNewLongitude('');
      setNewName('');
    })
    .catch(error => console.error('Error updating config:', error));
  };

  // Handle setting the refresh interval
  const handleSetRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/setRefresh', {
      pollInterval: pollInterval * 1000
    })
    .then(response => {
      setUrlConfig(response.data.urlConfig);
    })
    .catch(error => console.error('Error updating refresh interval:', error));
  };

  // Handle deleting a location configuration
  const handleDelete = (name) => {
    axios.delete('/api/config', { data: { name } })
      .then(response => {
        setUrlConfig(response.data.urlConfig);
      })
      .catch(error => console.error('Error deleting location:', error));
  };

  // Handle manual image refresh
  const handleImageRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/refreshImages', {})
      .catch(error => console.error('Error refreshing images:', error));
  };

  // Handle adding a new image
  const handleImageSubmit = (e) => {
    e.preventDefault();
    axios.post('/api/imageConfig', {
      url: newImageUrl,
      name: newImageName
    })
    .then(response => {
      setImageConfig(response.data.imageConfig);
      setNewImageUrl('');
      setNewImageName('');
    })
    .catch(error => console.error('Error updating image config:', error));
  };

  // Handle setting the image refresh interval
  const handleSetImageRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/setImageRefresh', {
      imagePollInterval: imagePollInterval * 1000
    })
    .then(response => {
      setImageConfig(response.data.imageConfig);
    })
    .catch(error => console.error('Error updating image refresh interval:', error));
  };

  // Handle deleting an image configuration
  const handleImageDelete = (name) => {
    axios.delete('/api/imageConfig', { data: { name } })
      .then(response => {
        setImageConfig(response.data.imageConfig);
      })
      .catch(error => console.error('Error deleting image:', error));
  };

  // Handle Arkansas burn ban toggle
  const handleArkansasBurnBanToggle = (e) => {
    const enabled = e.target.checked;
    setEnableArkansasBurnBan(enabled);
    axios.post('/api/arkansasBurnBan', { enabled })
      .then(response => {
        console.log('Arkansas burn ban setting updated');
      })
      .catch(error => console.error('Error updating Arkansas burn ban setting:', error));
  };

  return (
    <div className="container">
      {/* Manual refresh button */}
      <form>
        <button onClick={handleRefresh}>Refresh Weather Data</button>
        <button onClick={handleImageRefresh}>Refresh Images</button>
      </form>

      {/* List of configured locations */}
      <h3>Configured Locations</h3>
      <ul>
        {urlConfig.map((entry, index) => (
          <li key={index}>
            <strong>Name:</strong> {entry.name} <br />
            <strong>Latitude:</strong> {entry.latitude} <br />
            <strong>Longitude:</strong> {entry.longitude} <br />
            <button onClick={() => handleDelete(entry.name)}>Delete</button>
          </li>
        ))}
      </ul>

      <br />

      {/* Form to configure a new location */}
      <h3>Configure New Location</h3>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            Latitude:
            <input
              type="number"
              step="any"
              value={newLatitude}
              onChange={(e) => setNewLatitude(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label>
            Longitude:
            <input
              type="number"
              step="any"
              value={newLongitude}
              onChange={(e) => setNewLongitude(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label>
            Name:
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </label>
        </div>
        <button type="submit">Add Location</button>
      </form>

      {/* Form to change the refresh interval */}
      <h3>Change Weather Refresh Time</h3>
      <form onSubmit={handleSetRefresh}>
        <div>
          <label>
            Refresh Time (seconds):
            <input
              type="number"
              value={pollInterval}
              onChange={(e) => setPollInterval(e.target.value)}
              required
            />
          </label>
          <button type="submit">Save</button>
        </div>
      </form>

      {/* List of configured images */}
      <h3>Configured Images</h3>
      <ul>
        {imageConfig.map((entry, index) => (
          <li key={index}>
            <strong>Name:</strong> {entry.name} <br />
            <strong>URL:</strong> {entry.url} <br />
            <button onClick={() => handleImageDelete(entry.name)}>Delete</button>
          </li>
        ))}
      </ul>

      <br />

      {/* Form to configure a new image */}
      <h3>Configure New Image</h3>
      <form onSubmit={handleImageSubmit}>
        <div>
          <label>
            Image URL:
            <input
              type="url"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label>
            Image Name:
            <input
              type="text"
              value={newImageName}
              onChange={(e) => setNewImageName(e.target.value)}
              required
            />
          </label>
        </div>
        <button type="submit">Add Image</button>
      </form>

      {/* Form to change the image refresh interval */}
      <h3>Change Image Refresh Time</h3>
      <form onSubmit={handleSetImageRefresh}>
        <div>
          <label>
            Image Refresh Time (seconds):
            <input
              type="number"
              value={imagePollInterval}
              onChange={(e) => setImagePollInterval(e.target.value)}
              required
            />
          </label>
          <button type="submit">Save</button>
        </div>
      </form>

      {/* Arkansas Burn Ban checkbox */}
      <h3>Special Features</h3>
      <div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={enableArkansasBurnBan}
            onChange={handleArkansasBurnBanToggle}
          />
          Enable Arkansas Burn Ban Map
        </label>
        <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
          Automatically captures and saves the Arkansas burn ban map image every refresh cycle.
        </p>
      </div>
    </div>
  );
}

export default App;