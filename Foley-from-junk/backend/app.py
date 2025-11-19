
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
from sklearn.cluster import KMeans

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024
UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'outputs'
SLICES_FOLDER = 'outputs/slices'

for folder in [UPLOAD_FOLDER, OUTPUT_FOLDER, SLICES_FOLDER]:
    os.makedirs(folder, exist_ok=True)

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
