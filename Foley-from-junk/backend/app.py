from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import subprocess
import traceback
import json

app = Flask(__name__)

# cors configuration
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# file upload size limit (500mb)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

# allowed video formats
ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'}

# create necessary folders
os.makedirs('uploads', exist_ok=True)
os.makedirs('outputs', exist_ok=True)

def allowed_file(filename):
    """check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/api/health', methods=['GET'])
def health_check():
    """health check endpoint"""
    return jsonify({
        'status': 'ok',
        'message': 'backend is running on port 5001!',
        'uploads_dir': os.path.exists('uploads'),
        'outputs_dir': os.path.exists('outputs')
    })

@app.route('/api/upload-video', methods=['POST', 'OPTIONS'])
def upload_video():
    """upload video file"""
    if request.method == 'OPTIONS':
        return '', 204
    
    try:
        print("received upload request")
        
        if 'video' not in request.files:
            print("no video file in request")
            return jsonify({
                'success': False, 
                'error': 'no video file provided'
            }), 400
        
        file = request.files['video']
        
        if file.filename == '':
            print("empty filename")
            return jsonify({
                'success': False,
                'error': 'empty filename'
            }), 400
        
        if not allowed_file(file.filename):
            print(f"invalid file type: {file.filename}")
            return jsonify({
                'success': False,
                'error': f'invalid file type. allowed: {", ".join(ALLOWED_EXTENSIONS)}'
            }), 400
        
        filename = secure_filename(file.filename)
        filepath = os.path.join('uploads', filename)
        
        print(f"saving to: {filepath}")
        file.save(filepath)
        
        if not os.path.exists(filepath):
            print("file save failed")
            return jsonify({
                'success': False,
                'error': 'file save failed'
            }), 500
        
        file_size = os.path.getsize(filepath)
        print(f"upload successful: {filename} ({file_size / 1024 / 1024:.2f} mb)")
        
        return jsonify({
            'success': True, 
            'filename': filename,
            'size': file_size,
            'path': filepath
        }), 200
        
    except Exception as e:
        print(f"upload error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/detect-scenes', methods=['POST', 'OPTIONS'])
def detect_scenes():
    """detect scenes in video"""
    if request.method == 'OPTIONS':
        return '', 204
    
    try:
        print("starting scene detection")
        
        data = request.json
        if not data or 'filename' not in data:
            return jsonify({
                'success': False,
                'error': 'no filename provided'
            }), 400
        
        filename = data['filename']
        video_path = os.path.join('uploads', filename)
        
        if not os.path.exists(video_path):
            print(f"video not found: {video_path}")
            return jsonify({
                'success': False,
                'error': f'video file not found: {filename}'
            }), 404
        
        output_json = os.path.join('outputs', 'scenes.json')
        
        n_scenes = data.get('scenes', 3)
        sensitivity = data.get('sensitivity', 1.0)
        
        print(f"processing: {video_path}")
        print(f"  scenes: {n_scenes}, sensitivity: {sensitivity}")
        
        # call detection script
        result = subprocess.run([
            'python', 'autoSceneDetector.py',
            '--video', video_path,
            '--output', output_json,
            '--scenes', str(n_scenes),
            '--sensitivity', str(sensitivity)
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"detection failed: {result.stderr}")
            return jsonify({
                'success': False,
                'error': 'scene detection failed',
                'details': result.stderr
            }), 500
        
        print("detection complete")
        
        return jsonify({
            'success': True, 
            'output': output_json,
            'stdout': result.stdout
        }), 200
        
    except Exception as e:
        print(f"detection error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/get-scenes', methods=['GET'])
def get_scenes():
    """get scene detection results"""
    try:
        scenes_file = os.path.join('outputs', 'scenes.json')
        
        if not os.path.exists(scenes_file):
            return jsonify({
                'success': False,
                'error': 'no scene data available. please run detection first.'
            }), 404
        
        with open(scenes_file, 'r', encoding='utf-8') as f:
            scenes_data = json.load(f)
        
        return jsonify(scenes_data), 200
        
    except Exception as e:
        print(f"error reading scenes: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/download-scenes', methods=['GET'])
def download_scenes():
    """download scene json file"""
    try:
        scenes_file = os.path.join('outputs', 'scenes.json')
        
        if not os.path.exists(scenes_file):
            return jsonify({'error': 'no scene data available'}), 404
        
        return send_file(
            scenes_file,
            mimetype='application/json',
            as_attachment=True,
            download_name='scenes.json'
        )
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/video/<filename>')
def get_video(filename):
    """get video file"""
    try:
        filepath = os.path.join('uploads', filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'video not found'}), 404
        return send_file(filepath)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("="*50)
    print("foley from junk server")
    print("="*50)
    print("server: http://localhost:5001")
    print("upload folder:", os.path.abspath('uploads'))
    print("output folder:", os.path.abspath('outputs'))
    print("cors enabled")
    print(f"max upload size: {app.config['MAX_CONTENT_LENGTH'] / 1024 / 1024:.0f} mb")
    print("="*50)
    app.run(debug=True, port=5001, host='0.0.0.0')