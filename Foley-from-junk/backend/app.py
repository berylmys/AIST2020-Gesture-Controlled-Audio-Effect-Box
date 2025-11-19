
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import json
import traceback
from pathlib import Path
import numpy as np
import librosa
import soundfile as sf
from moviepy.editor import VideoFileClip
import shutil
from sklearn.cluster import KMeans
import soundExtracting
from datetime import datetime

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024
UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'outputs'
SLICES_FOLDER = 'outputs/slices'
FOLEY_FOLDER = 'outputs/foley_library'
FOLEY_DB = os.path.join(OUTPUT_FOLDER, 'foley_library.json')
COMPOSE_HISTORY = os.path.join(OUTPUT_FOLDER, 'compose_history.json')

for folder in [UPLOAD_FOLDER, OUTPUT_FOLDER, SLICES_FOLDER]:
    os.makedirs(folder, exist_ok=True)
os.makedirs(FOLEY_FOLDER, exist_ok=True)

# ==================== key functions ====================

def extract_audio_from_video(video_path, output_audio='temp_audio.wav'):
    """extract audio from video"""
    try:
        video = VideoFileClip(video_path)
        audio = video.audio
        if audio is None:
            raise ValueError("Video has no audio track")
        audio.write_audiofile(output_audio, verbose=False, logger=None)
        video.close()
        return output_audio
    except Exception as e:
        print(f"Failed to extract audio: {e}")
        return None

def load_audio(path, sr=22050):
    """load audio files"""
    y, sr = librosa.load(path, sr=sr, mono=True)
    return y, sr

def detect_onset_slices(y, sr, hop_length=512, min_duration=0.02):
    """use onset to slice"""
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop_length, backtrack=True)
    frames = librosa.frames_to_samples(onsets, hop_length=hop_length)
    frames = np.unique(np.concatenate(([0], frames, [len(y)])))
    
    min_len = int(min_duration * sr)
    intervals = []
    for i in range(len(frames)-1):
        s, e = frames[i], frames[i+1]
        if e - s >= min_len:
            intervals.append((s, e))
    return intervals

def detect_silence_slices(y, sr, top_db=30, min_duration=0.03):
    """use silence detection to slice"""
    intervals = librosa.effects.split(y, top_db=top_db)
    min_len = int(min_duration * sr)
    filtered = []
    for s, e in intervals:
        if e - s >= min_len:
            filtered.append((s, e))
    return filtered

def analyze_slice_features(y, sr):
    """feature dict"""
    features = {
        'rms': float(np.mean(librosa.feature.rms(y=y))),
        'zcr': float(np.mean(librosa.feature.zero_crossing_rate(y))),
        'spectral_centroid': float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))),
        'spectral_bandwidth': float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr))),
        'onset_strength': float(np.mean(librosa.onset.onset_strength(y=y, sr=sr)))
    }
    
    # simple categories
    if features['onset_strength'] > 1.5:
        features['type'] = 'impact'  # 打击音效
    elif features['rms'] < 0.02:
        features['type'] = 'ambient'  # 环境音
    elif features['spectral_centroid'] > 3000:
        features['type'] = 'high_freq'  # 高频音效
    else:
        features['type'] = 'continuous'  # 连续音效
    
    return features

def normalize_audio(y, peak=0.98):
    """normalize"""
    maxv = np.max(np.abs(y)) + 1e-9
    return (y / maxv) * peak

def fade_in_out(y, sr, fade_ms=10):
    """添加淡入淡出"""
    n = len(y)
    fade_samples = int(sr * (fade_ms / 1000.0))
    if fade_samples <= 0:
        return y
    win = np.ones(n)
    fade_in = np.linspace(0.0, 1.0, fade_samples)
    fade_out = np.linspace(1.0, 0.0, fade_samples)
    win[:fade_samples] = fade_in
    win[-fade_samples:] = fade_out
    return y * win

def save_slice(y, sr, output_dir, base_name, idx, features):
    """save slices"""
    y = normalize_audio(y)
    y = fade_in_out(y, sr, fade_ms=5)
    
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    filename = f"{base_name}_slice{idx:03d}.wav"
    filepath = output_dir / filename
    
    sf.write(str(filepath), y, sr)
    
    return {
        'filename': filename,
        'path': str(filepath),
        'features': features
    }

# ==================== API 端点 ====================

@app.route('/api/health', methods=['GET'])
def health_check():
    """robust"""
    return jsonify({
        'status': 'ok',
        'message': 'Enhanced Foley Backend Running!',
        'version': '2.0'
    })

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """load videos or audios"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'Empty filename'}), 400
        
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)
        
        file_type = 'video' if filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')) else 'audio'
        
        return jsonify({
            'success': True,
            'filename': filename,
            'filepath': filepath,
            'file_type': file_type,
            'size': os.path.getsize(filepath)
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/analyze-and-slice', methods=['POST'])
def analyze_and_slice():
    """
    核心功能：分析并切片音频
    支持：视频文件、音频文件、自定义参数
    """
    try:
        data = request.json
        filename = data.get('filename')
        method = data.get('method', 'onset')  # onset 或 silence
        min_duration = data.get('min_duration', 0.02)
        top_db = data.get('top_db', 30)
        
        if not filename:
            return jsonify({'success': False, 'error': 'No filename provided'}), 400
        
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'File not found'}), 404
        
        print(f"\n{'='*60}")
        print(f"Processing: {filename}")
        print(f"Method: {method}, Min Duration: {min_duration}s")
        print(f"{'='*60}\n")
        
        # 1. 提取音频（如果是视频）
        if filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
            print("Extracting audio from video...")
            temp_audio = os.path.join(OUTPUT_FOLDER, 'temp_extracted_audio.wav')
            audio_path = extract_audio_from_video(filepath, temp_audio)
            if not audio_path:
                return jsonify({'success': False, 'error': 'Audio extraction failed'}), 500
        else:
            audio_path = filepath
        
        # 2. 加载音频
        print("Loading audio...")
        y, sr = load_audio(audio_path)
        duration = len(y) / sr
        print(f"Duration: {duration:.2f} seconds\n")
        
        # 3. 检测切片
        print(f"Detecting slices using {method} method...")
        if method == 'onset':
            intervals = detect_onset_slices(y, sr, min_duration=min_duration)
        else:
            intervals = detect_silence_slices(y, sr, top_db=top_db, min_duration=min_duration)
        
        print(f"Found {len(intervals)} slices\n")
        
        if len(intervals) == 0:
            return jsonify({
                'success': False,
                'error': 'No slices detected. Try adjusting parameters.',
                'suggestion': 'Lower min_duration or sensitivity'
            }), 400
        
        # 4. 处理每个切片
        print("Processing slices...")
        slices_data = []
        base_name = Path(filename).stem
        
        for idx, (start, end) in enumerate(intervals):
            slice_audio = y[start:end]
            start_time = start / sr
            end_time = end / sr
            
            # 分析特征
            features = analyze_slice_features(slice_audio, sr)
            features['start_time'] = start_time
            features['end_time'] = end_time
            features['duration'] = end_time - start_time
            
            # 保存切片
            slice_info = save_slice(
                slice_audio, sr, SLICES_FOLDER, base_name, idx, features
            )
            
            slices_data.append(slice_info)
            
            print(f"  Slice {idx+1}: {start_time:.2f}s - {end_time:.2f}s "
                  f"({features['duration']:.2f}s) [{features['type']}]")
        
        # 5. 聚类相似的音效
        print("\nClustering similar sounds...")
        n_clusters = min(4, len(slices_data))
        
        if n_clusters > 1:
            X = np.array([[
                s['features']['rms'],
                s['features']['zcr'],
                s['features']['spectral_centroid'],
                s['features']['onset_strength']
            ] for s in slices_data])
            
            X_normalized = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            labels = kmeans.fit_predict(X_normalized)
            
            for i, label in enumerate(labels):
                slices_data[i]['cluster'] = int(label)
        else:
            for s in slices_data:
                s['cluster'] = 0
        
        # 6. 组织结果
        result = {
            'success': True,
            'original_file': filename,
            'total_duration': duration,
            'num_slices': len(slices_data),
            'num_clusters': n_clusters,
            'slices': slices_data,
            'method': method,
            'parameters': {
                'min_duration': min_duration,
                'top_db': top_db if method == 'silence' else None
            }
        }
        
        # 7. 保存结果
        result_path = os.path.join(OUTPUT_FOLDER, f'{base_name}_analysis.json')
        with open(result_path, 'w') as f:
            json.dump(result, f, indent=2)
        
        print(f"\n✓ Analysis complete! Saved to {result_path}\n")
        
        # 清理临时文件
        if 'temp_extracted_audio.wav' in audio_path:
            try:
                os.remove(audio_path)
            except:
                pass
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/get-slice/<filename>')
def get_slice(filename):
    """获取音频切片文件"""
    try:
        filepath = os.path.join(SLICES_FOLDER, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        return send_file(filepath, mimetype='audio/wav')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/upload-foley', methods=['POST'])
def upload_foley():
    """Upload a custom foley sample into the server library"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'Empty filename'}), 400

        filename = secure_filename(file.filename)
        dest = os.path.join(FOLEY_FOLDER, filename)
        file.save(dest)

        # analyze basic features for search/filtering and slice the uploaded foley
        try:
            # create per-foley slice folder
            base = Path(filename).stem
            foley_slice_dir = os.path.join(FOLEY_FOLDER, f"{base}_slices")
            os.makedirs(foley_slice_dir, exist_ok=True)

            # use soundExtracting.process_file to create slices and features
            slice_paths, slice_features = soundExtracting.process_file(dest, foley_slice_dir, method='silence', analyze=True)
            features = {
                'slice_count': len(slice_paths),
                'slices': [
                    {
                        'path': p,
                        'features': f
                    } for p, f in zip(slice_paths, slice_features)
                ]
            }
        except Exception:
            try:
                y, sr = load_audio(dest)
                features = analyze_slice_features(y, sr)
            except Exception:
                features = {}

        # persist metadata
        db = []
        try:
            if os.path.exists(FOLEY_DB):
                with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                    db = json.load(f)
        except Exception:
            db = []

        entry = {
            'filename': filename,
            'path': dest,
            'features': features,
            'slices_dir': os.path.join(FOLEY_FOLDER, f"{Path(filename).stem}_slices") if features and features.get('slice_count',0)>0 else None
        }
        db.append(entry)
        with open(FOLEY_DB, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=2)

        return jsonify({'success': True, 'entry': entry})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/foley-library', methods=['GET'])
def foley_library():
    try:
        db = []
        if os.path.exists(FOLEY_DB):
            with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                db = json.load(f)

        # augment entries with slice listing if available
        for entry in db:
            slices_dir = entry.get('slices_dir')
            entry['slices'] = []
            if slices_dir and os.path.exists(slices_dir):
                files = sorted([f for f in os.listdir(slices_dir) if f.lower().endswith('.wav')])
                for fn in files:
                    entry['slices'].append({'filename': fn, 'path': os.path.join(slices_dir, fn)})

        # if db empty, auto-scan FOLEY_FOLDER
        if not db:
            files = [f for f in os.listdir(FOLEY_FOLDER) if f.lower().endswith(('.wav', '.mp3', '.flac', '.m4a', '.ogg'))]
            for fn in files:
                db.append({'filename': fn, 'path': os.path.join(FOLEY_FOLDER, fn), 'features': {}, 'slices': []})
        return jsonify({'success': True, 'library': db})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/compose-history', methods=['GET'])
def compose_history():
    try:
        history = []
        if os.path.exists(COMPOSE_HISTORY):
            with open(COMPOSE_HISTORY, 'r', encoding='utf-8') as f:
                history = json.load(f)
        return jsonify({'success': True, 'history': history})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/compose', methods=['POST'])
def compose_with_foley():
    """Compose original audio with selected foley samples inserted at detected slice positions.
    Expected JSON payload:
      {
        'filename': '<original uploaded filename>',
        'slices': [ ... ]  # analysisData.slices from analyze-and-slice
        'mappings': [ { 'slice_index': 0, 'foley_filename': 'kick.wav', 'gain': 1.0 }, ... ]
      }
    Returns: generated mixed audio path
    """
    try:
        data = request.json
        filename = data.get('filename')
        slices = data.get('slices', [])
        mappings = data.get('mappings', [])

        if not filename or not slices or not mappings:
            return jsonify({'success': False, 'error': 'filename, slices and mappings are required'}), 400

        upload_path = os.path.join(UPLOAD_FOLDER, filename)
        if not os.path.exists(upload_path):
            return jsonify({'success': False, 'error': 'Original file not found'}), 404

        # if video, extract its audio first
        if filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
            temp_audio = os.path.join(OUTPUT_FOLDER, 'temp_compose_audio.wav')
            audio_path = extract_audio_from_video(upload_path, temp_audio)
            if not audio_path:
                return jsonify({'success': False, 'error': 'Audio extraction failed'}), 500
            src_audio_path = audio_path
        else:
            src_audio_path = upload_path

        y, sr = load_audio(src_audio_path)
        out = y.copy()

        # For each mapping, replace the entire slice region with the foley slice
        for m in mappings:
            idx = int(m.get('slice_index'))
            foley_fn = m.get('foley_filename')
            gain = float(m.get('gain', 1.0))
            if idx < 0 or idx >= len(slices):
                continue

            slice_feat = slices[idx]['features']
            start_time = float(slice_feat.get('start_time', 0.0))
            end_time = float(slice_feat.get('end_time', start_time))
            start_sample = int(start_time * sr)
            end_sample = int(end_time * sr)
            slice_len = end_sample - start_sample

            # locate foley file (may be in subdir)
            foley_path = None
            candidate = os.path.join(FOLEY_FOLDER, foley_fn)
            if os.path.exists(candidate):
                foley_path = candidate
            else:
                # search recursively
                for root, dirs, files in os.walk(FOLEY_FOLDER):
                    if foley_fn in files:
                        foley_path = os.path.join(root, foley_fn)
                        break
                    
            if not foley_path or not os.path.exists(foley_path):
                continue

            fy, fsr = load_audio(foley_path, sr=sr)
            # apply gain
            fy = fy * gain

            # ensure new segment matches slice length: trim or pad with silence
            if len(fy) > slice_len:
                new_seg = fy[:slice_len]
            elif len(fy) < slice_len:
                pad = slice_len - len(fy)
                new_seg = np.pad(fy, (0, pad), mode='constant')
            else:
                new_seg = fy

            # replace slice region with new segment
            if end_sample > len(out):
                # pad out if slice extends beyond original (shouldn't typically happen)
                out = np.pad(out, (0, end_sample - len(out)), mode='constant')
            out[start_sample:end_sample] = new_seg

        # normalize final mix to avoid clipping
        out = normalize_audio(out, peak=0.98)

        composed_name = f"{Path(filename).stem}_composed.wav"
        composed_path = os.path.join(OUTPUT_FOLDER, composed_name)
        sf.write(composed_path, out, sr)

        # cleanup temp audio
        try:
            if 'temp_compose_audio.wav' in src_audio_path and os.path.exists(src_audio_path):
                os.remove(src_audio_path)
        except:
            pass

        # record compose history (audit)
        try:
            history = []
            if os.path.exists(COMPOSE_HISTORY):
                with open(COMPOSE_HISTORY, 'r', encoding='utf-8') as hf:
                    history = json.load(hf)
        except Exception:
            history = []

        hist_entry = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'original_file': filename,
            'composed_file': composed_name,
            'composed_path': composed_path,
            'mappings': mappings,
            'duration_samples': int(len(out)),
            'sr': int(sr)
        }
        history.insert(0, hist_entry)
        try:
            with open(COMPOSE_HISTORY, 'w', encoding='utf-8') as hf:
                json.dump(history, hf, indent=2)
        except Exception:
            pass

        return jsonify({'success': True, 'composed': composed_name, 'path': composed_path})
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/get-composed/<filename>')
def get_composed(filename):
    try:
        filepath = os.path.join(OUTPUT_FOLDER, secure_filename(filename))
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        return send_file(filepath, mimetype='audio/wav')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/get-foley/<path:fname>')
def get_foley(fname):
    """Serve original foley file or any file inside the foley slices directories"""
    try:
        # sanitize filename (we'll search within FOLEY_FOLDER)
        target = None
        # direct path check
        direct = os.path.join(FOLEY_FOLDER, fname)
        if os.path.exists(direct):
            target = direct
        else:
            # search recursively for a file with matching basename
            for root, dirs, files in os.walk(FOLEY_FOLDER):
                for f in files:
                    if f == os.path.basename(fname):
                        candidate = os.path.join(root, f)
                        target = candidate
                        break
                if target:
                    break

        if not target or not os.path.exists(target):
            return jsonify({'error': 'File not found'}), 404

        return send_file(target, mimetype='audio/wav')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/delete-foley', methods=['POST'])
def delete_foley():
    """Delete a foley file and its derived slices from the library.
    Expects JSON: { 'filename': 'name.wav' }
    """
    try:
        data = request.json
        if not data or 'filename' not in data:
            return jsonify({'success': False, 'error': 'filename required'}), 400
        filename = secure_filename(data['filename'])

        # load DB
        db = []
        if os.path.exists(FOLEY_DB):
            try:
                with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                    db = json.load(f)
            except Exception:
                db = []

        # find entry
        entry = None
        for e in db:
            if e.get('filename') == filename:
                entry = e
                break

        # attempt to remove files
        removed = []
        # remove main file from FOLEY_FOLDER
        main_path = os.path.join(FOLEY_FOLDER, filename)
        if os.path.exists(main_path):
            try:
                os.remove(main_path)
                removed.append(main_path)
            except Exception:
                pass

        # remove slices dir if present in entry
        if entry and entry.get('slices_dir'):
            sd = entry.get('slices_dir')
            if os.path.exists(sd):
                try:
                    shutil.rmtree(sd)
                    removed.append(sd)
                except Exception:
                    pass

        # remove any matching slice files in FOLEY_FOLDER subdirs
        for root, dirs, files in os.walk(FOLEY_FOLDER):
            for f in files:
                if f == filename or f.startswith(Path(filename).stem + '_slice'):
                    try:
                        p = os.path.join(root, f)
                        os.remove(p)
                        removed.append(p)
                    except Exception:
                        pass

        # remove entry from db and write back
        new_db = [e for e in db if e.get('filename') != filename]
        try:
            with open(FOLEY_DB, 'w', encoding='utf-8') as f:
                json.dump(new_db, f, indent=2)
        except Exception:
            pass

        return jsonify({'success': True, 'removed': removed})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/demo-files', methods=['GET'])
def get_demo_files():
    """获取演示文件列表"""
    demo_files = [
        {'name': 'Knife on Glass', 'file': 'Knife_glass.wav'},
        {'name': 'Boiling Water', 'file': 'boilingWater.wav'},
        {'name': 'Wooden Comb', 'file': 'Wooden_comb_taps.wav'},
        {'name': 'Sloshing Water', 'file': 'Sloshing_water.wav'}
    ]
    return jsonify({'demo_files': demo_files})

if __name__ == '__main__':
    print("="*60)
    print("🎵 ENHANCED FOLEY FROM JUNK SERVER")
    print("="*60)
    print("Server: http://localhost:5001")
    print("Features:")
    print("  ✓ Video → Audio extraction")
    print("  ✓ Smart audio slicing (onset/silence)")
    print("  ✓ Feature analysis & clustering")
    print("  ✓ Timeline generation for UI")
    print("="*60)
    app.run(debug=True, port=5001, host='0.0.0.0')
