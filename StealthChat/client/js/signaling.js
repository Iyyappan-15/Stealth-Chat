'use strict';

const Signaling = (() => {
  let socket;

  function connect(room, onMessage) {
    socket = new WebSocket(`ws://${location.host}`);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join', room }));
    };

    socket.onmessage = e => {
      onMessage(JSON.parse(e.data));
    };
  }

  function send(data) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(data));
    }
  }

  return { connect, send };
})();
function close() {
  if (socket) socket.close();
}
return { connect, send, close };
