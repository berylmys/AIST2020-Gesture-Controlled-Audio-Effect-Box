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
  const [foleyLibrary, setFoleyLibrary] = useState([]);
  const [foleyUploading, setFoleyUploading] = useState(false);
  const [selectedFoleyForSlice, setSelectedFoleyForSlice] = useState('');
  const [mappings, setMappings] = useState([]);
  const [composedUrl, setComposedUrl] = useState(null);
  const [composing, setComposing] = useState(false);
  const [composeHistory, setComposeHistory] = useState([]);
  const [mediaUrl, setMediaUrl] = useState(null);
  const composedAudioRef = useRef(null);
  const previousComposedRef = useRef(null);
  const playingVideoComposedRef = useRef(false);
  
  // para
  const [method, setMethod] = useState('onset');
  const [minDuration, setMinDuration] = useState(0.02);
  const [topDb, setTopDb] = useState(30);
  
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const videoRef = useRef(null);
  const previewAudioRef = useRef(null);

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

  const stopPreview = () => {
    try {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        if (previewAudioRef.current.src) {
          URL.revokeObjectURL(previewAudioRef.current.src);
        }
        previewAudioRef.current = null;
      }
      if (videoRef.current) videoRef.current.muted = false;
      if (audioRef.current) audioRef.current.muted = false;
    } catch (e) {}
  };

  const previewSlice = async (slice, options = { seekOnly: false }) => {
    // Seek main media (video or audio) to slice start and play; if mapping exists, play foley slice instead (muting main audio)
    stopPreview();
    try {
      const start = slice.features.start_time;
      const mapping = mappings.find(m => m.slice_index === (analysisData ? analysisData.slices.indexOf(slice) : -1));

      // seek and play main media
      if (file && fileType === 'video' && videoRef.current) {
        const v = videoRef.current;
        v.currentTime = start;
        // if we're previewing a foley, mute video audio
        if (mapping && mapping.foley_filename) {
          v.muted = true;
        } else {
          v.muted = false;
        }
        v.play();
      } else if (file && fileType !== 'video' && audioRef.current) {
        const a = audioRef.current;
        a.currentTime = start;
        if (mapping && mapping.foley_filename) a.muted = true; else a.muted = false;
        a.play();
      }

      // if there is a mapping and not seekOnly, play the mapped foley slice
      if (mapping && mapping.foley_filename && !options.seekOnly) {
        const fn = mapping.foley_filename;
        const r = await fetch(`http://localhost:5001/api/get-foley/${fn}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const pa = new Audio(url);
        previewAudioRef.current = pa;
        pa.play();
        setPlayingSlice(slice);
        pa.onended = () => {
          setPlayingSlice(null);
          stopPreview();
        };
      } else {
        // no mapping: just play main media for short period or until user stops
        setPlayingSlice(slice);
      }
    } catch (err) {
      console.error('Preview failed', err);
      stopPreview();
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

  const fetchFoleyLibrary = async () => {
    try {
      const res = await fetch('http://localhost:5001/api/foley-library');
      const data = await res.json();
      if (data.success) {
        setFoleyLibrary(data.library);
      }
    } catch (e) {
      console.error('Failed to fetch foley library', e);
    }
  };

  const handleDeleteFoley = async (fname) => {
    if (!window.confirm(`Delete foley '${fname}' and its derived slices? This cannot be undone.`)) return;
    try {
      const res = await fetch('http://localhost:5001/api/delete-foley', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fname })
      });
      const data = await res.json();
      if (data.success) {
        setMessage('🗑️ Foley deleted');
        fetchFoleyLibrary();
        fetchComposeHistory();
      } else {
        setMessage('❌ Delete failed: ' + (data.error || ''));
      }
    } catch (err) {
      setMessage('❌ Delete failed: ' + err.message);
    }
  };

  const insertFoleyToSliceDirect = (fname) => {
    if (selectedSlice == null) {
      setMessage('⚠️  Select a slice in the timeline/list first');
      return;
    }
    const exists = mappings.find(m => m.slice_index === selectedSlice);
    let next = [...mappings];
    if (exists) {
      next = next.map(m => m.slice_index === selectedSlice ? { ...m, foley_filename: fname } : m);
    } else {
      next.push({ slice_index: selectedSlice, foley_filename: fname, gain: 1.0 });
    }
    setMappings(next);
    setMessage(`➕ Inserted ${fname} into slice #${selectedSlice + 1}`);
  };

  const fetchComposeHistory = async () => {
    try {
      const res = await fetch('http://localhost:5001/api/compose-history');
      const data = await res.json();
      if (data.success) setComposeHistory(data.history);
    } catch (e) {
      console.error('Failed to fetch compose history', e);
    }
  };

  useEffect(() => {
    fetchFoleyLibrary();
    fetchComposeHistory();
  }, []);

  // cleanup composed object URL on unmount
  useEffect(() => {
    return () => {
      try {
        if (previousComposedRef.current) URL.revokeObjectURL(previousComposedRef.current);
      } catch (e) {}
    };
  }, []);

  const stopVideoWithComposed = () => {
    try {
      if (composedAudioRef.current) {
        composedAudioRef.current.pause();
        composedAudioRef.current.currentTime = 0;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.muted = false;
      }
      // if there is a stored cleanup, call it
      try {
        if (playingVideoComposedRef.current && playingVideoComposedRef.current.cleanup) {
          playingVideoComposedRef.current.cleanup();
        }
      } catch (e) {}
      playingVideoComposedRef.current = false;
    } catch (e) {}
  };

  const playVideoWithComposed = async () => {
    if (!composedUrl || !videoRef.current || !composedAudioRef.current) return;
    try {
      const v = videoRef.current;
      const a = composedAudioRef.current;

      // sync start time
      a.currentTime = v.currentTime || 0;

      // mute original video audio and play both
      v.muted = true;
      // ensure composed audio is unmuted
      a.muted = false;

      // when video pauses, pause composed audio; when video plays, resume composed audio
      const onPlay = () => { try { if (a.paused) a.play(); } catch (e) {} };
      const onPause = () => { try { if (!a.paused) a.pause(); } catch (e) {} };
      const onEnded = () => { stopVideoWithComposed();
      };

      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      v.addEventListener('ended', onEnded);

      // attach cleanup to composed audio end as well
      const onAudioEnded = () => { stopVideoWithComposed(); };
      a.addEventListener('ended', onAudioEnded);

      // start playback
      await Promise.all([v.play().catch(()=>{}), a.play().catch(()=>{})]);

      playingVideoComposedRef.current = true;

      // store cleanup on the ref so stop can remove listeners
      playingVideoComposedRef.current = {
        cleanup: () => {
          try {
            v.removeEventListener('play', onPlay);
            v.removeEventListener('pause', onPause);
            v.removeEventListener('ended', onEnded);
            a.removeEventListener('ended', onAudioEnded);
            v.muted = false;
          } catch (e) {}
        }
      };
    } catch (err) {
      console.error('Failed to play video with composed audio', err);
      stopVideoWithComposed();
    }
  };

  const handleFoleyUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFoleyUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('http://localhost:5001/api/upload-foley', {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        fetchFoleyLibrary();
        setMessage('✅ Foley uploaded to library');
      } else {
        setMessage('❌ Foley upload failed: ' + (data.error || ''));
      }
    } catch (err) {
      setMessage('❌ Foley upload failed: ' + err.message);
    } finally {
      setFoleyUploading(false);
    }
  };

  useEffect(() => {
    // create object URL for uploaded file so preview players can use it
    if (file) {
      try {
        const u = URL.createObjectURL(file);
        setMediaUrl(u);
        return () => {
          try { URL.revokeObjectURL(u); } catch (e) {}
          setMediaUrl(null);
        };
      } catch (e) {
        console.error('Failed to create media URL', e);
      }
    } else {
      setMediaUrl(null);
    }
  }, [file]);

  const insertFoleyToSlice = () => {
    if (selectedSlice == null || !selectedFoleyForSlice) return;
    const exists = mappings.find(m => m.slice_index === selectedSlice);
    let next = [...mappings];
    if (exists) {
      next = next.map(m => m.slice_index === selectedSlice ? { ...m, foley_filename: selectedFoleyForSlice } : m);
    } else {
      next.push({ slice_index: selectedSlice, foley_filename: selectedFoleyForSlice, gain: 1.0 });
    }
    setMappings(next);
    setMessage('➕ Foley assigned to slice');
  };

  const handleCompose = async () => {
    if (!analysisData || mappings.length === 0) {
      setMessage('Select at least one mapping before composing');
      return;
    }
    setComposing(true);
    setMessage('🔧 Composing audio with foley...');
    try {
      const res = await fetch('http://localhost:5001/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, slices: analysisData.slices, mappings })
      });
      const data = await res.json();
      if (data.success) {
        setMessage('✅ Compose complete');
        // fetch composed blob
        const r2 = await fetch(`http://localhost:5001/api/get-composed/${data.composed}`);
        const blob = await r2.blob();
        const url = URL.createObjectURL(blob);
        // revoke previous composed URL if present
        try {
          if (previousComposedRef.current) URL.revokeObjectURL(previousComposedRef.current);
        } catch (e) {}
        previousComposedRef.current = url;
        setComposedUrl(url);
      } else {
        setMessage('❌ Compose failed: ' + (data.error || ''));
      }
    } catch (err) {
      setMessage('❌ Compose failed: ' + err.message);
    } finally {
      setComposing(false);
    }
  };

  // composed output is playable via the embedded player (`composedAudioRef`)

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
          {mediaUrl && (
            <section className="card">
              <h2>▶️ Player Preview</h2>
              {fileType === 'video' ? (
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  style={{ width: '100%', maxHeight: '420px', background: '#000' }}
                />
              ) : (
                <audio ref={audioRef} src={mediaUrl} controls style={{ width: '100%' }} />
              )}
              <div style={{ marginTop: '8px', color: 'var(--text-dim)' }}>
                Tip: Click timeline events to seek the player and preview mapped foley.
              </div>
            </section>
          )}
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

                    const mapped = mappings.find(m => m.slice_index === idx);
                    return (
                      <div
                        key={idx}
                        className={`timeline-segment ${isSelected ? 'selected' : ''} ${isPlaying ? 'playing' : ''}`}
                        style={{
                          left: `${startPercent}%`,
                          width: `${Math.max(widthPercent, 0.5)}%`,
                          backgroundColor: getClusterColor(slice.cluster),
                          border: mapped ? '3px solid #ffd166' : (isSelected ? '2px solid white' : 'none'),
                          opacity: isPlaying ? 1 : 0.85,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        onClick={() => {
                          setSelectedSlice(idx);
                          previewSlice(slice);
                        }}
                        title={`${formatTime(slice.features.start_time)} - ${getSoundTypeLabel(slice.features.type)}`}
                      >
                        {mapped && (
                          <span style={{ fontSize: '0.75em', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '6px' }}>{mapped.foley_filename}</span>
                        )}
                        {widthPercent > 2 && !mapped && (
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
                    {/* Resource Library */}
                    <section className="card">
                      <h2>📚 Foley Resource Library</h2>
                      <p style={{ color: 'var(--text-dim)' }}>Uploaded foley samples and their derived slices.</p>
                      <div style={{ display: 'grid', gap: '10px' }}>
                        {foleyLibrary.map((f, i) => (
                          <div key={i} style={{ border: '1px solid rgba(0,0,0,0.06)', padding: '8px', borderRadius: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>{f.filename}</strong>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => {
                                  // play original foley file if directly available
                                  fetch(`http://localhost:5001/api/get-foley/${f.filename}`).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); new Audio(u).play(); setTimeout(()=>URL.revokeObjectURL(u),5000)}).catch(()=>{});
                                }}>▶️ Play</button>
                                <button onClick={() => insertFoleyToSliceDirect(f.filename)} disabled={selectedSlice == null}>➕ Insert</button>
                                <button onClick={() => handleDeleteFoley(f.filename)} style={{ color: '#a00' }}>🗑️ Delete</button>
                              </div>
                            </div>
                            {f.slices && f.slices.length > 0 ? (
                              <div style={{ marginTop: '6px' }}>
                                <em>Slices:</em>
                                <ul>
                                  {f.slices.map((s, idx) => (
                                            <li key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                              <span style={{ flex: 1 }}>{s.filename}</span>
                                              <button onClick={()=>{fetch(`http://localhost:5001/api/get-foley/${s.filename}`).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); new Audio(u).play(); setTimeout(()=>URL.revokeObjectURL(u),5000)}).catch(()=>{});}}>▶️</button>
                                              <button onClick={() => insertFoleyToSliceDirect(s.filename)} disabled={selectedSlice == null}>➕ Insert</button>
                                            </li>
                                          ))}
                                </ul>
                              </div>
                            ) : (
                              <div style={{ marginTop: '6px' }}><em>No slices available</em></div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* Compose history (audit log) */}
                    <section className="card">
                      <h2>🧾 Modification Log</h2>
                      <p style={{ color: 'var(--text-dim)' }}>Recent compose operations and mappings (audit trail).</p>
                      <div style={{ maxHeight: '240px', overflow: 'auto' }}>
                        {composeHistory.length === 0 && <div>No compose history yet.</div>}
                        {composeHistory.map((h, idx) => (
                          <div key={idx} style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                            <div><strong>{h.timestamp}</strong> — {h.original_file} → {h.composed_file}</div>
                            <div style={{ fontSize: '0.9em', color: 'var(--text-dim)' }}>
                              Mappings: {h.mappings.map(m => `${m.slice_index}@${m.foley_filename}`).join(', ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

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
                      previewSlice(slice);
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label className="upload-box" htmlFor="foley-upload" style={{ padding: '6px 10px' }}>
                    <span className="upload-text">➕ Upload Foley</span>
                  </label>
                  <input id="foley-upload" type="file" accept="audio/*" onChange={handleFoleyUpload} style={{ display: 'none' }} />
                  <button onClick={fetchFoleyLibrary}>📚 Refresh Library</button>
                </div>

                {/* quick mapping UI */}
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select value={selectedFoleyForSlice} onChange={(e) => setSelectedFoleyForSlice(e.target.value)}>
                    <option value="">Select Foley for selected slice</option>
                    {foleyLibrary.map(f => (
                      <option key={f.filename} value={f.filename}>{f.filename}</option>
                    ))}
                  </select>
                  <button onClick={insertFoleyToSlice} disabled={selectedSlice == null || !selectedFoleyForSlice}>Insert Foley</button>
                  <button onClick={handleCompose} disabled={composing || mappings.length === 0}>{composing ? 'Composing...' : '🎚️ Compose'}</button>
                </div>

                {/* Current mappings */}
                {mappings.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <strong>Current Mappings:</strong>
                    <ul>
                      {mappings.map((m, i) => (
                        <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span>Slice #{m.slice_index + 1}</span>
                          <span style={{ color: 'var(--primary)' }}>{m.foley_filename}</span>
                          <button onClick={() => {
                            // remove mapping
                            setMappings(prev => prev.filter(x => !(x.slice_index === m.slice_index && x.foley_filename === m.foley_filename)));
                          }}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {composedUrl && (
                  <div style={{ marginTop: '8px' }}>
                    <audio ref={composedAudioRef} src={composedUrl} controls style={{ width: '100%' }} />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                      {fileType === 'video' && (
                        <>
                          <button onClick={playVideoWithComposed}>▶️ Play Video with Composed Audio</button>
                          <button onClick={stopVideoWithComposed}>⏹️ Stop</button>
                        </>
                      )}
                      <a href={composedUrl} download={`${filename}_composed.wav`} style={{ marginLeft: '8px' }}>💾 Download Composed</a>
                    </div>
                  </div>
                )}

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
