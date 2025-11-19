import React, { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [filename, setFilename] = useState('');
  const [fileType, setFileType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [message, setMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [playingSlice, setPlayingSlice] = useState(null);
  const [selectedSlice, setSelectedSlice] = useState(null);
  
  // para
  const [method, setMethod] = useState('onset');
  const [minDuration, setMinDuration] = useState(0.02);
  const [topDb, setTopDb] = useState(30);
  
  const audioRef = useRef(null);
  const waveformRef = useRef(null);

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setUploading(true);
    setMessage('📤 Uploading...');

    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const response = await fetch('http://localhost:5001/api/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      setFilename(data.filename);
      setFileType(data.file_type);
      setFile(uploadedFile);
      setMessage(`✅ ${data.file_type === 'video' ? 'Video' : 'Audio'} uploaded successfully!`);
      setAnalysisData(null);
    } catch (error) {
      setMessage('❌ Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!filename) return;

    setAnalyzing(true);
    setMessage('🔍 Analyzing audio and detecting slices...');

    try {
      const response = await fetch('http://localhost:5001/api/analyze-and-slice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          method,
          min_duration: minDuration,
          top_db: topDb
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setAnalysisData(data);
        setMessage(`✨ Found ${data.num_slices} sound events in ${data.num_clusters} categories!`);
      } else {
        setMessage(`❌ ${data.error}. ${data.suggestion || ''}`);
      }
    } catch (error) {
      setMessage('❌ Analysis failed: ' + error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const playSlice = async (slice) => {
    try {
      const response = await fetch(`http://localhost:5001/api/get-slice/${slice.filename}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      audio.play();
      
      setPlayingSlice(slice);
      audio.onended = () => {
        setPlayingSlice(null);
        URL.revokeObjectURL(url);
      };
    } catch (error) {
      console.error('Failed to play slice:', error);
    }
  };

  const getClusterColor = (cluster) => {
    const colors = [
      '#00d9ff', '#ff00ff', '#00ff88', '#ffcc00',
      '#ff3d71', '#764ba2', '#667eea', '#f093fb'
    ];
    return colors[cluster % colors.length];
  };

  const getSoundTypeLabel = (type) => {
    const labels = {
      'impact': '🥁 Impact',
      'ambient': '🌊 Ambient',
      'high_freq': '🔔 High Freq',
      'continuous': '➰ Continuous'
    };
    return labels[type] || type;
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
  };

  const downloadJSON = () => {
    if (!analysisData) return;
    const blob = new Blob([JSON.stringify(analysisData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_foley_data.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="App">
      <header>
        <h1>🎵 Foley from Junk</h1>
        <p>Smart Audio Slicing & Foley Detection</p>
      </header>

      <main>
        {/* 上传区域 */}
        <section className="card">
          <h2>📁 Upload File</h2>
          <label className="upload-box" htmlFor="file-upload">
            <span className="upload-text">
              {file ? `📄 ${file.name}` : '📤 Choose video or audio file'}
            </span>
            <span className="upload-hint">
              {file ? `Type: ${fileType}` : 'MP4, AVI, MOV, WAV, MP3...'}
            </span>
          </label>
          <input
            id="file-upload"
            type="file"
            accept="video/*,audio/*"
            onChange={handleFileUpload}
            disabled={uploading}
            style={{ display: 'none' }}
          />
          {uploading && <p className="status">Uploading...</p>}
        </section>

        {/* 参数设置 */}
        {filename && !analysisData && (
          <section className="card">
            <h2>⚙️ Detection Settings</h2>
            <div className="settings">
              <label>
                <strong>Detection Method:</strong>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    border: '2px solid rgba(0, 217, 255, 0.3)',
                    background: 'rgba(0, 217, 255, 0.05)',
                    color: 'var(--primary)',
                    fontSize: '1em'
                  }}
                >
                  <option value="onset">Onset Detection (Best for impacts)</option>
                  <option value="silence">Silence Detection (Best for pauses)</option>
                </select>
              </label>
              
              <label>
                <strong>Minimum Duration (seconds):</strong>
                <input
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={minDuration}
                  onChange={(e) => setMinDuration(parseFloat(e.target.value))}
                />
                <span style={{ fontSize: '0.85em', color: 'var(--text-dim)' }}>
                  Smaller = more sensitive, captures shorter sounds
                </span>
              </label>

              {method === 'silence' && (
                <label>
                  <strong>Silence Threshold (dB):</strong>
                  <input
                    type="number"
                    min="10"
                    max="60"
                    step="5"
                    value={topDb}
                    onChange={(e) => setTopDb(parseInt(e.target.value))}
                  />
                  <span style={{ fontSize: '0.85em', color: 'var(--text-dim)' }}>
                    Lower = more sensitive to quiet sounds
                  </span>
                </label>
              )}
            </div>
            
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="btn-primary"
            >
              {analyzing ? '🔍 Analyzing...' : '🚀 Start Analysis'}
            </button>
          </section>
        )}

        {/* 消息提示 */}
        {message && (
          <div className={`message ${message.includes('❌') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}

        {/* 分析结果 - 时间轴视图 */}
        {analysisData && (
          <>
            {/* 摘要卡片 */}
            <section className="card">
              <h2>📊 Analysis Results</h2>
              <div className="summary">
                <div className="summary-card">
                  <span className="label">Total Duration</span>
                  <span className="value">{analysisData.total_duration.toFixed(1)}s</span>
                </div>
                <div className="summary-card">
                  <span className="label">Sound Events</span>
                  <span className="value">{analysisData.num_slices}</span>
                </div>
                <div className="summary-card">
                  <span className="label">Categories</span>
                  <span className="value">{analysisData.num_clusters}</span>
                </div>
              </div>
            </section>

            {/* time editor */}
            <section className="card">
              <h2>🎬 Timeline Editor</h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '20px' }}>
                Click on any sound event to preview. Different colors represent different sound categories.
              </p>

              {/* time axis tracker */}
              <div className="timeline-container">
                <div className="timeline-track" ref={waveformRef}>
                  {analysisData.slices.map((slice, idx) => {
                    const startPercent = (slice.features.start_time / analysisData.total_duration) * 100;
                    const widthPercent = (slice.features.duration / analysisData.total_duration) * 100;
                    const isSelected = selectedSlice === idx;
                    const isPlaying = playingSlice?.filename === slice.filename;

                    return (
                      <div
                        key={idx}
                        className={`timeline-segment ${isSelected ? 'selected' : ''} ${isPlaying ? 'playing' : ''}`}
                        style={{
                          left: `${startPercent}%`,
                          width: `${Math.max(widthPercent, 0.5)}%`,
                          backgroundColor: getClusterColor(slice.cluster),
                          border: isSelected ? '2px solid white' : 'none',
                          opacity: isPlaying ? 1 : 0.85
                        }}
                        onClick={() => {
                          setSelectedSlice(idx);
                          playSlice(slice);
                        }}
                        title={`${formatTime(slice.features.start_time)} - ${getSoundTypeLabel(slice.features.type)}`}
                      >
                        {widthPercent > 2 && (
                          <span style={{ fontSize: '0.7em' }}>{slice.features.duration.toFixed(2)}s</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* timestample */}
                <div className="time-markers">
                  {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <span key={f} style={{ left: `${f * 100}%` }}>
                      {formatTime(analysisData.total_duration * f)}
                    </span>
                  ))}
                </div>
              </div>

              {/* illustration */}
              <div className="legend">
                {Array.from(new Set(analysisData.slices.map(s => s.cluster))).map(cluster => {
                  const slicesInCluster = analysisData.slices.filter(s => s.cluster === cluster);
                  const avgType = slicesInCluster[0]?.features.type || 'unknown';
                  
                  return (
                    <div key={cluster} className="legend-item">
                      <span
                        className="legend-color"
                        style={{ backgroundColor: getClusterColor(cluster) }}
                      />
                      <span>
                        Category {cluster + 1}: {getSoundTypeLabel(avgType)} ({slicesInCluster.length} events)
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* list */}
            <section className="card">
              <h2>📝 Sound Events List</h2>
              <div className="slices-list">
                {analysisData.slices.map((slice, idx) => (
                  <div
                    key={idx}
                    className={`slice-item ${selectedSlice === idx ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedSlice(idx);
                      playSlice(slice);
                    }}
                    style={{
                      borderLeft: `4px solid ${getClusterColor(slice.cluster)}`
                    }}
                  >
                    <div className="slice-info">
                      <span className="slice-number">#{idx + 1}</span>
                      <span className="slice-type">{getSoundTypeLabel(slice.features.type)}</span>
                      <span className="slice-time">
                        {formatTime(slice.features.start_time)} → {formatTime(slice.features.end_time)}
                      </span>
                      <span className="slice-duration">
                        {slice.features.duration.toFixed(2)}s
                      </span>
                    </div>
                    <div className="slice-features">
                      <span>Energy: {(slice.features.rms * 100).toFixed(1)}%</span>
                      <span>Freq: {slice.features.spectral_centroid.toFixed(0)} Hz</span>
                      <span>Impact: {slice.features.onset_strength.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* buttons */}
            <section className="card">
              <h2>🛠️ Actions</h2>
              <div className="actions">
                <button onClick={downloadJSON}>
                  💾 Download Analysis JSON
                </button>
                <button onClick={() => {
                  setAnalysisData(null);
                  setFile(null);
                  setFilename('');
                  setMessage('');
                }}>
                  🔄 Analyze New File
                </button>
                <button
                  onClick={() => alert('Hardware integration coming soon! This JSON can control Arduino/Raspberry Pi.')}
                  style={{ background: 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)' }}
                >
                  🔌 Send to Hardware
                </button>
              </div>
            </section>

            {/* JSON preview */}
            <details className="json-preview">
              <summary>👁️ View Raw JSON Data</summary>
              <pre>{JSON.stringify(analysisData, null, 2)}</pre>
            </details>
          </>
        )}
      </main>

      <footer>
        💡 This tool automatically detects and categorizes sound events for foley replacement
      </footer>
    </div>
  );
}

export default App;
