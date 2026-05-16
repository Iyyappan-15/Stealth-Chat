'use strict';

const WebRTC = (() => {
  let pc, channel;

  function init(sendSignal, onMessage, onOpen) {
    pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
});



    pc.onicecandidate = e => {
      if (e.candidate) sendSignal({ type: 'ice', candidate: e.candidate });
    };

    pc.ondatachannel = e => {
      channel = e.channel;
      channel.onmessage = ev => onMessage(ev.data);
      channel.onopen = () => onOpen();
    };
  }

  async function createOffer(sendSignal, onOpen) {
    channel = pc.createDataChannel('chat');

    channel.onopen = () => onOpen();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: 'offer', offer });
  }

  async function handleOffer(offer, sendSignal) {
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: 'answer', answer });
  }

  async function handleAnswer(answer) {
    await pc.setRemoteDescription(answer);
  }

  function handleIce(candidate) {
    pc.addIceCandidate(candidate);
  }

  function send(msg) {
    channel.send(msg);
  }

  return {
    init,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIce,
    send
  };
})();
function close() {
  if (channel) channel.close();
  if (pc) pc.close();
}
return {
  init,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIce,
  send,
  close
};
