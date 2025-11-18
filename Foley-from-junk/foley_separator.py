import librosa
import soundfile as sf
import numpy as np
from scipy import signal 
from typing import List, Tuple, Dict
import os

class AudioSeparator:
  def __init__(self, 
               threshold: float = 0.02, # <0.02, treated as silence
               min_silence_duration: float = 0.1, # mini length of silence
               hop_length: int = 512):

  
    def load_audio(self, file_path: str) -> Tuple[np.ndarray, int]: # Function to load audio
      audio, sr = librosa.load(file_path, sr = None, mono = True)
      print(f"loading audio files: {file_path}")
      print(f" sampling rate: {sr} Hz, duration: {len(audio)/sr:.2f} seconds")

    def detect_event(self, audio: np/ndarray, sr: int) -> List[Tuple[float, float]]:
      rms = librosa.feature.rms(y=audio, hop_length=self.hop_length)[0]
      rms = rms / np.max(rms)
      times = librosa.frames_to_time(np.arrange(len(rms)),
                                     sr=sr,
                                     hop_length=self.hop_length)
      
      above_threshold = rms > self.threshold
      events = []
      in_event = False
      start_time = 0

      min_silence_samples = int(self.min_silence_duration * sr / self.hop_length)
      silence_counter = 0

      for i, is_sound in enumerate(above_threshold):
        if is_sound:
          if not in_event: 
            # NEW event starts
            start_time = times[i]
            in_event = True
          silence_counter = 0
        else: 
          if in_event:
            silence_counter += 1
            # if the silence lasts too long, end the event
            if silence_counter >= min_silence_samples: 
                end_time = times[i - min_silence_samples]
                events.append((start_time, end_time))
                in_event = False
                silence_counter = 0

            
            


