import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './styles.css';

function App() {
  const [urlConfig, setUrlConfig] = useState([]);
  const [pollInterval, setPollInterval] = useState(60);
  const [newLatitude, setNewLatitude] = useState('');
  const [newLongitude, setNewLongitude] = useState('');
  const [newName, setNewName] = useState('');

  // Fetch the current configuration when the component loads
  useEffect(() => {
    axios.get('/api/config')
      .then(response => {
        setUrlConfig(response.data.urlConfig);
        setPollInterval(response.data.pollInterval / 1000);
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

  return (
    <div className="container">
      {/* Manual refresh button */}
      <form>
        <button onClick={handleRefresh}>Refresh</button>
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
        <button type="submit">Add</button>
      </form>

      {/* Form to change the refresh interval */}
      <h3>Change Refresh Time</h3>
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
    </div>
  );
}

export default App;