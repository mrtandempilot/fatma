import React from 'react';

interface StatusIndicatorProps {
    status: 'idle' | 'listening' | 'active' | 'muted';
    isSpeaking?: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, isSpeaking }) => {
    const getStatusConfig = () => {
        switch (status) {
            case 'listening':
                return {
                    color: 'bg-blue-400',
                    text: 'Listening for "Hey Aura"',
                    pulse: true,
                    glow: false
                };
            case 'active':
                return {
                    color: 'bg-green-500',
                    text: isSpeaking ? 'Speaking...' : 'Active',
                    pulse: false,
                    glow: true
                };
            case 'muted':
                return {
                    color: 'bg-red-500',
                    text: 'Muted',
                    pulse: false,
                    glow: false
                };
            default:
                return {
                    color: 'bg-gray-400',
                    text: 'Idle',
                    pulse: false,
                    glow: false
                };
        }
    };

    const config = getStatusConfig();

    return (
        <div className="flex items-center gap-3">
            <div className="relative">
                <div
                    className={`w-3 h-3 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''
                        }`}
                />
                {config.glow && (
                    <div className={`absolute inset-0 w-3 h-3 rounded-full ${config.color} opacity-50 blur-sm animate-ping`} />
                )}
            </div>
            <span className="text-sm font-medium text-gray-600">{config.text}</span>
        </div>
    );
};

export default StatusIndicator;
