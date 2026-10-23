import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MockMeshTransport } from '@aira/ui';

import { EmergencyGridScreen } from '../EmergencyGridScreen';

// NOTE: @testing-library/react-native v14 - `render` and `fireEvent` are async; always await them.

describe('EmergencyGridScreen', () => {
  let log: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('renders the four massive SOS buttons in English with Bisaya hints', async () => {
    await render(<EmergencyGridScreen />);

    for (const [english, bisaya] of [
      ['Fire', 'Sunog'],
      ['Medical', 'Medikal'],
      ['Crime', 'Krimen'],
      ['Flood', 'Baha'],
    ] as const) {
      expect(screen.getByText(english)).toBeTruthy();
      expect(screen.getByText(bisaya)).toBeTruthy();
    }

    expect(screen.getByText('What is your emergency?')).toBeTruthy();
  });

  it('broadcasts the exact compressed mesh payload on press (mock transport)', async () => {
    await render(<EmergencyGridScreen />);
    await fireEvent.press(screen.getByTestId('sos-SUNOG'));

    await waitFor(() => expect(log).toHaveBeenCalledWith('["SUNOG",10.3157,123.8854]'));
  });

  it('broadcasts a payload for every category', async () => {
    await render(<EmergencyGridScreen />);
    await fireEvent.press(screen.getByTestId('sos-MEDIKAL'));
    await fireEvent.press(screen.getByTestId('sos-KRIMEN'));
    await fireEvent.press(screen.getByTestId('sos-BAHA'));

    await waitFor(() => {
      expect(log).toHaveBeenCalledWith('["MEDIKAL",10.3157,123.8854]');
      expect(log).toHaveBeenCalledWith('["KRIMEN",10.3157,123.8854]');
      expect(log).toHaveBeenCalledWith('["BAHA",10.3157,123.8854]');
    });
  });

  it('shows the last transmitted payload on screen', async () => {
    await render(<EmergencyGridScreen />);
    await fireEvent.press(screen.getByTestId('sos-BAHA'));

    await waitFor(() =>
      expect(screen.getByTestId('last-payload').props.children).toBe('["BAHA",10.3157,123.8854]'),
    );
  });

  it('contains no voice/chat/AI affordances (PRODUCT.md §2)', async () => {
    await render(<EmergencyGridScreen />);

    expect(screen.queryByText(/voice|microphone|record|hold to talk|chat/i)).toBeNull();
    expect(screen.queryByLabelText(/voice|microphone/i)).toBeNull();
  });

  it('uses plain punctuation and a readable empty state', async () => {
    await render(<EmergencyGridScreen />);

    expect(screen.getByTestId('last-payload').props.children).toBe('No transmission yet');
    expect(screen.queryByText(/[\u2014\u2013]/)).toBeNull();
  });

  it('shows mesh standby by default', async () => {
    await render(<EmergencyGridScreen />);
    expect(screen.getByTestId('mesh-status').props.children).toBe('Mesh link: standby');
  });

  it('queues the alert offline and shows the queued count, then drains on reconnect', async () => {
    // Observe what actually reaches the wire via the transport's own callback.
    const wire: string[] = [];
    const transport = new MockMeshTransport({
      initialState: 'offline',
      onWire: (serialized) => wire.push(serialized),
    });
    await render(<EmergencyGridScreen transport={transport} />);

    await fireEvent.press(screen.getByTestId('sos-SUNOG'));

    // Offline: nothing hit the wire, the status reflects a queued alert.
    expect(wire).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByTestId('mesh-status').props.children).toBe('Offline - queued (1)'),
    );

    // Link returns: the outbox drains automatically and the queued alert hits the wire.
    await act(async () => {
      transport.setLinkState('standby');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(wire).toContain('["SUNOG",10.3157,123.8854]'));
    await waitFor(() =>
      expect(screen.getByTestId('mesh-status').props.children).toBe('Mesh link: standby'),
    );
  });
});
