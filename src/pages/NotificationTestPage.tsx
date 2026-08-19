import { useEffect, useState } from 'react';
import { Bell, Copy, Check } from 'lucide-react';

export function NotificationTestPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check whether token already exists
    const savedToken = localStorage.getItem(
      'gridvision_fcm_token'
    );

    if (savedToken) {
      setToken(savedToken);
    }

    // Listen for a newly generated token
    const handleToken = (event: Event) => {
      const customEvent = event as CustomEvent<string>;

      if (customEvent.detail) {
        setToken(customEvent.detail);
      }
    };

    window.addEventListener(
      'fcm-token-received',
      handleToken
    );

    return () => {
      window.removeEventListener(
        'fcm-token-received',
        handleToken
      );
    };
  }, []);

  const copyToken = async () => {
    if (!token) return;

    await navigator.clipboard.writeText(token);

    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F1F5F9',
        padding: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          background:
            'linear-gradient(to right, #1e3a8a, #1d4ed8)',
          borderRadius: 20,
          padding: 20,
          color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,.15)',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Bell size={26} />

          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              Notification Test
            </h1>

            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                opacity: 0.85,
              }}
            >
              Firebase Cloud Messaging
            </div>
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div
        style={{
          background: '#fff',
          borderRadius: 18,
          padding: 20,
          boxShadow: '0 4px 12px rgba(0,0,0,.08)',
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#1E293B',
            marginBottom: 10,
          }}
        >
          Push Notification Status
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: token ? '#15803D' : '#DC2626',
            fontWeight: 600,
            marginBottom: 20,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: token ? '#22C55E' : '#EF4444',
            }}
          />

          {token
            ? 'Registered successfully'
            : 'FCM token not available'}
        </div>

        {/* Token */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#475569',
            marginBottom: 8,
          }}
        >
          FCM Device Token
        </div>

        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #CBD5E1',
            borderRadius: 12,
            padding: 12,
            wordBreak: 'break-all',
            fontSize: 12,
            color: '#334155',
            minHeight: 70,
          }}
        >
          {token || 'Waiting for FCM token...'}
        </div>

        {token && (
          <button
            onClick={copyToken}
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: '#1D4ED8',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copied ? (
              <>
                <Check size={18} />
                Copied
              </>
            ) : (
              <>
                <Copy size={18} />
                Copy Token
              </>
            )}
          </button>
        )}
      </div>

      {/* Explanation */}
      <div
        style={{
          marginTop: 20,
          background: '#fff',
          borderRadius: 18,
          padding: 20,
          boxShadow: '0 4px 12px rgba(0,0,0,.08)',
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#1E293B',
            marginBottom: 10,
          }}
        >
          What is this token?
        </div>

        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: '#64748B',
          }}
        >
          This unique FCM token identifies this Android
          device for push notifications. For this test, we
          will use it to send a notification specifically to
          this device.
        </div>
      </div>
    </div>
  );
}