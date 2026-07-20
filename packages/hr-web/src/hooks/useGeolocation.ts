// Geolocation capture — no JSX. Wraps navigator.geolocation.getCurrentPosition
// behind a discriminated-union state so consumers never juggle boolean flag
// combinations (skill rule: discriminated unions for async state).

import { useCallback, useState } from 'react';

export interface GeoCoords {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export type GeolocationState =
  | { status: 'idle' }
  | { status: 'prompting' }
  | { status: 'success'; coords: GeoCoords }
  | { status: 'error'; message: string; unavailable: boolean };

interface UseGeolocationResult {
  state: GeolocationState;
  request: () => void;
  reset: () => void;
}

export function useGeolocation(): UseGeolocationResult {
  const [state, setState] = useState<GeolocationState>({ status: 'idle' });

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'error', message: 'Geolocation is not supported on this device.', unavailable: true });
      return;
    }
    setState({ status: 'prompting' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          status: 'success',
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          },
        });
      },
      (err) => {
        const denied = err.code === err.PERMISSION_DENIED;
        setState({
          status: 'error',
          message: denied
            ? 'Location permission was denied. Please allow location access to check in.'
            : 'Could not determine your location. Please try again.',
          unavailable: false,
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, request, reset };
}
