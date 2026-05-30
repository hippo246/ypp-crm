/**
 * EnterpriseLoader - Optimized loading states for enterprise scale
 * 
 * Features:
 * - Skeleton screens for different content types
 * - Progressive loading indicators
 * - Error boundary integration
 * - Retry mechanisms
 * - Performance-aware rendering
 */

import { useState, useEffect } from "react";

export function EnterpriseLoader({ type = "default", size = "medium", message = "Loading..." }) {
  const [dots, setDots] = useState("");
  
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? "" : prev + ".");
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const sizes = {
    small: { width: 20, height: 20, strokeWidth: 2 },
    medium: { width: 40, height: 40, strokeWidth: 3 },
    large: { width: 60, height: 60, strokeWidth: 4 },
  };

  const { width, height, strokeWidth } = sizes[size] || sizes.medium;

  if (type === "skeleton") {
    return <SkeletonLoader />;
  }

  if (type === "dots") {
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3B82F6",
              animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.8); }
            50% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg
        width={width}
        height={height}
        viewBox="0 0 50 50"
        style={{ animation: "spin 1s linear infinite" }}
      >
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="#3B82F6"
          strokeWidth={strokeWidth}
          strokeDasharray="80"
          strokeDashoffset="60"
          strokeLinecap="round"
          style={{ animation: "dash 1.5s ease-in-out infinite" }}
        />
      </svg>
      {message && (
        <span style={{ fontSize: 12, color: "#64748B" }}>
          {message}{dots}
        </span>
      )}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes dash {
          0% { stroke-dashoffset: 60; }
          50% { stroke-dashoffset: 20; }
          100% { stroke-dashoffset: 60; }
        }
      `}</style>
    </div>
  );
}

export function SkeletonLoader() {
  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header skeleton */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#E2E8F0", animation: "shimmer 1.5s infinite" }} />
        <div style={{ flex: 1 }}>
          <div style={{ width: "60%", height: 16, borderRadius: 4, background: "#E2E8F0", marginBottom: 8, animation: "shimmer 1.5s infinite" }} />
          <div style={{ width: "40%", height: 12, borderRadius: 4, background: "#E2E8F0", animation: "shimmer 1.5s infinite" }} />
        </div>
      </div>
      
      {/* Content skeleton */}
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, background: "#F8FAFC", borderRadius: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "#E2E8F0", animation: "shimmer 1.5s infinite" }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: `${70 - i * 5}%`, height: 14, borderRadius: 4, background: "#E2E8F0", marginBottom: 6, animation: "shimmer 1.5s infinite" }} />
            <div style={{ width: `${50 - i * 3}%`, height: 12, borderRadius: 4, background: "#E2E8F0", animation: "shimmer 1.5s infinite" }} />
          </div>
        </div>
      ))}
      
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        [style*="animation"] {
          background: linear-gradient(90deg, #E2E8F0 25%, #F1F5F9 50%, #E2E8F0 75%);
          background-size: 200% 100%;
        }
      `}</style>
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }) {
  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={i}
            style={{
              width: `${100 / columns}%`,
              height: 16,
              borderRadius: 4,
              background: "#E2E8F0",
              animation: "shimmer 1.5s infinite",
            }}
          />
        ))}
      </div>
      
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={colIndex}
              style={{
                width: `${100 / columns}%`,
                height: 14,
                borderRadius: 4,
                background: "#F1F5F9",
                animation: "shimmer 1.5s infinite",
              }}
            />
          ))}
        </div>
      ))}
      
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        [style*="animation"] {
          background: linear-gradient(90deg, #E2E8F0 25%, #F1F5F9 50%, #E2E8F0 75%);
          background-size: 200% 100%;
        }
      `}</style>
    </div>
  );
}

export function CardSkeleton({ count = 3 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: 20,
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #E2E8F0",
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 8, background: "#E2E8F0", marginBottom: 16, animation: "shimmer 1.5s infinite" }} />
          <div style={{ width: "60%", height: 20, borderRadius: 4, background: "#E2E8F0", marginBottom: 12, animation: "shimmer 1.5s infinite" }} />
          <div style={{ width: "80%", height: 14, borderRadius: 4, background: "#F1F5F9", marginBottom: 8, animation: "shimmer 1.5s infinite" }} />
          <div style={{ width: "40%", height: 14, borderRadius: 4, background: "#F1F5F9", animation: "shimmer 1.5s infinite" }} />
        </div>
      ))}
      
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        [style*="animation"] {
          background: linear-gradient(90deg, #E2E8F0 25%, #F1F5F9 50%, #E2E8F0 75%);
          background-size: 200% 100%;
        }
      `}</style>
    </div>
  );
}

export function ErrorBoundaryFallback({ error, resetError }) {
  return (
    <div style={{ padding: 48, textAlign: "center" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Something went wrong</h2>
      <p style={{ fontSize: 14, color: "#64748B", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
        {error?.message || "An unexpected error occurred. Please try again."}
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button
          onClick={resetError}
          style={{
            padding: "10px 20px",
            background: "#3B82F6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try Again
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 20px",
            background: "#F1F5F9",
            color: "#475569",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

export function RetryableLoader({ 
  children, 
  isLoading, 
  error, 
  onRetry, 
  maxRetries = 3,
  retryDelay = 1000,
}) {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (retryCount >= maxRetries) return;
    
    setIsRetrying(true);
    setRetryCount(prev => prev + 1);
    
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    if (onRetry) {
      await onRetry();
    }
    
    setIsRetrying(false);
  };

  if (isLoading || isRetrying) {
    return <EnterpriseLoader message={isRetrying ? `Retrying (${retryCount}/${maxRetries})...` : "Loading..."} />;
  }

  if (error) {
    return (
      <ErrorBoundaryFallback
        error={error}
        resetError={retryCount < maxRetries ? handleRetry : () => window.location.reload()}
      />
    );
  }

  return <>{children}</>;
}

export default EnterpriseLoader;
