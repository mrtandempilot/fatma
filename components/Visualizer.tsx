
import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isSpeaking }) => {
  return (
    <div className="flex items-center justify-center space-x-2 h-24">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className={`w-2 bg-blue-500 rounded-full transition-all duration-300 ${
            isActive ? (isSpeaking ? 'animate-bounce' : 'animate-pulse opacity-50') : 'h-2 opacity-20'
          }`}
          style={{
            height: isActive ? (isSpeaking ? `${Math.random() * 80 + 20}%` : '20%') : '8px',
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
};

export default Visualizer;
