import React, { useState, useRef } from 'react';
import './App.css';

function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoFilename, setVideoFilename] = useState('');
  const [uploading, setUploading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState('');
  const [sceneData, setSceneData] = useState(null);
  const [numActivityTypes, setNumActivityTypes] = useState(3);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hoveredScene, setHoveredScene] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [wasPlaying, setWasPlaying] = useState(false);
  
  const videoRef = useRef(null);
  const timelineRef = useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setMessage('Uploading video...');

    const formData = new FormData();
    formData.append('video', file);

    try {
      const response = await fetch('http://localhost:5001/api/upload-video', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      setVideoFilename(data.filename);
      setVideoFile(file);
      setVideoUrl(`http://localhost:5001/api/video/${data.filename}`);
      setMessage('Video uploaded successfully! 🎉');
      setSceneData(null);
    } catch (error) {
      setMessage('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDetect = async () => {
    if (!videoFilename) return;

    setDetecting(true);
    setMessage('Analyzing video...');

    try {
      await fetch('http://localhost:5001/api/detect-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: videoFilename, scenes: numActivityTypes, sensitivity })
      });
      
      const scenesResponse = await fetch('http://localhost:5001/api/get-scenes');
      const scenesData = await scenesResponse.json();
      
      setSceneData(scenesData);
      setMessage('Scene detection complete! ✨');
    } catch (error) {
      setMessage('Detection failed: ' + error.message);
    } finally {
      setDetecting(false);
    }
  };

  const downloadJSON = () => {
    if (!sceneData) return;
    const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'scenes.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const seekToPosition = (e) => {
    if (!timelineRef.current || !videoRef.current || !sceneData) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = percentage * sceneData.total_duration;
    
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleTimelineMouseDown = (e) => {
    if (!videoRef.current) return;
    
    setWasPlaying(!videoRef.current.paused);
    videoRef.current.pause();
    setIsDragging(true);
    seekToPosition(e);
  };

  const handleTimelineMouseMove = (e) => {
    if (isDragging) {
      seekToPosition(e);
    }
  };

  const handleTimelineMouseUp = () => {
    setIsDragging(false);
    if (wasPlaying && videoRef.current) {
      videoRef.current.play();
    }
  };

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleTimelineMouseMove);
      document.addEventListener('mouseup', handleTimelineMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleTimelineMouseMove);
        document.removeEventListener('mouseup', handleTimelineMouseUp);
      };
    }
  }, [isDragging, wasPlaying]);

  const getColor = (id) => {
    const colors = ['#00d9ff', '#ff00ff', '#00ff88', '#ffcc00', '#ff3d71', '#764ba2', '#667eea', '#f093fb', '#4facfe', '#43e97b'];
    return colors[parseInt(id) % colors.length];
  };

  const formatTime = (sec) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="App">
      <header>
        <h1>🎵 Foley from Junk</h1>
        <p>Automatic Scene Detection for Sound Effect Control</p>
      </header>

      <main>
        <section className="card">
          <h2>Upload Video</h2>
          <label className="upload-box" htmlFor="video-upload">
            <span className="upload-text">{videoFile ? videoFile.name : 'Choose a video file'}</span>
            <span className="upload-hint">{videoFile ? 'Click to change' : 'MP4, AVI, MOV, MKV...'}</span>
          </label>
          <input id="video-upload" type="file" accept="video/*" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
          {uploading && <p className="status">Uploading...</p>}
        </section>

        {videoUrl && (
          <section className="card">
            <h2>Video Preview</h2>
            <video 
              ref={videoRef}
              controls 
              src={videoUrl}
              onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
              className="video-player"
            />
            
            {sceneData && (
              <div className="timeline-section">
                <div className="timeline-header">
                  <h3>Timeline (Drag to seek)</h3>
                  <span className="time-display">{formatTime(currentTime)} / {formatTime(sceneData.total_duration)}</span>
                </div>
                
                <div 
                  ref={timelineRef}
                  className="timeline-track"
                  onMouseDown={handleTimelineMouseDown}
                  style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
                >
                  {Object.entries(sceneData.activity_groups || {}).map(([gid, group]) => 
                    group.scenes.map((scene, i) => (
                      <div
                        key={`${gid}-${i}`}
                        className="timeline-segment"
                        style={{
                          left: `${(scene.start / sceneData.total_duration) * 100}%`,
                          width: `${(scene.duration / sceneData.total_duration) * 100}%`,
                          backgroundColor: getColor(gid),
                          pointerEvents: 'none'
                        }}
                        onMouseEnter={() => !isDragging && setHoveredScene({ gid, scene, group })}
                        onMouseLeave={() => setHoveredScene(null)}
                      >
                        {scene.duration / sceneData.total_duration > 0.05 && <span>{scene.duration.toFixed(1)}s</span>}
                      </div>
                    ))
                  )}
                  <div className="timeline-cursor" style={{ left: `${(currentTime / sceneData.total_duration) * 100}%` }} />
                </div>
                
                <div className="time-markers">
                  {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <span key={f} style={{ left: `${f * 100}%` }}>{formatTime(sceneData.total_duration * f)}</span>
                  ))}
                </div>
                
                {hoveredScene && !isDragging && (
                  <div className="tooltip">
                    <strong>Type {parseInt(hoveredScene.gid) + 1}</strong>
                    <div>{hoveredScene.group.description}</div>
                    <div>{hoveredScene.scene.start_formatted} - {hoveredScene.scene.end_formatted}</div>
                  </div>
                )}
                
                <div className="legend">
                  {Object.entries(sceneData.activity_groups || {}).map(([gid, group]) => (
                    <div key={gid} className="legend-item">
                      <span className="legend-color" style={{ backgroundColor: getColor(gid) }} />
                      <span>Type {parseInt(gid) + 1}: {group.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {videoFilename && (
          <section className="card">
            <h2>Detect Scenes</h2>
            <div className="settings">
              <label>
                <strong>Activity Types:</strong>
                <input type="number" min="1" max="10" value={numActivityTypes} 
                  onChange={(e) => setNumActivityTypes(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))} />
              </label>
              <label>
                <strong>Sensitivity:</strong>
                <input type="number" min="0.1" max="3" step="0.1" value={sensitivity} 
                  onChange={(e) => setSensitivity(Math.max(0.1, Math.min(3, parseFloat(e.target.value) || 1)))} />
              </label>
            </div>
            <button onClick={handleDetect} disabled={detecting} className="btn-primary">
              {detecting ? 'Analyzing...' : 'Start Detection'}
            </button>
          </section>
        )}

        {message && <div className={`message ${message.includes('fail') ? 'error' : 'success'}`}>{message}</div>}

        {sceneData && (
          <section className="card">
            <h2>Results</h2>
            
            <div className="summary">
              <div className="summary-card">
                <span className="label">Duration</span>
                <span className="value">{sceneData.total_duration?.toFixed(1)}s</span>
              </div>
              <div className="summary-card">
                <span className="label">Types</span>
                <span className="value">{sceneData.num_activity_types}</span>
              </div>
              <div className="summary-card">
                <span className="label">Scenes</span>
                <span className="value">{sceneData.total_scenes}</span>
              </div>
            </div>

            <div className="activity-list">
              {Object.entries(sceneData.activity_groups || {}).map(([gid, group]) => (
                <div key={gid} className="activity-group" style={{ borderLeftColor: getColor(gid) }}>
                  <h3>
                    <span className="color-dot" style={{ backgroundColor: getColor(gid) }} />
                    Type {parseInt(gid) + 1}: {group.description}
                  </h3>
                  <p>Appears {group.count} time{group.count > 1 ? 's' : ''}</p>
                  
                  <div className="scene-list">
                    {group.scenes.map((scene, i) => (
                      <div key={i} className="scene-item" onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = scene.start;
                        }
                      }}>
                        <span>{scene.start_formatted} - {scene.end_formatted}</span>
                        <span>{scene.duration.toFixed(1)}s</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="actions">
              <button onClick={downloadJSON}>📥 Download JSON</button>
              <button onClick={() => alert('Hardware integration coming soon!')}>🔌 Send to Hardware</button>
            </div>

            <details className="json-preview">
              <summary>View JSON</summary>
              <pre>{JSON.stringify(sceneData, null, 2)}</pre>
            </details>
          </section>
        )}
      </main>

      <footer>💡 Control hardware devices with generated JSON data</footer>
    </div>
  );
}

export default App;
