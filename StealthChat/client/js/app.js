'use strict';

document.addEventListener("DOMContentLoaded", () => {
    const roomInput = document.getElementById("room-code-input");
    const joinBtn = document.getElementById("btn-join-room");
    const createBtn = document.getElementById("btn-create-room");
    const cancelBtn = document.getElementById("btn-cancel-connect");

if (cancelBtn) {
  cancelBtn.addEventListener("click", () => {
    location.reload(); // simple & safe reset
  });
}


    if (!roomInput || !joinBtn || !createBtn) {
        console.error("Room UI elements not found");
        return;
    }

    // Enable join button only when 6 chars
    roomInput.addEventListener("input", () => {
        roomInput.value = roomInput.value.toUpperCase();
        joinBtn.disabled = roomInput.value.length !== 6;
    });

    // JOIN ROOM
    joinBtn.addEventListener("click", () => {
        const code = roomInput.value.trim();
        if (code.length !== 6) return;

        joinRoom(code, false);
    });
    function joinRoom(roomCode, isHost) {
  console.log("Joining room:", roomCode);
  console.log("Host:", isHost);

  document.getElementById("display-room-code").textContent = roomCode;
  switchScreen("screen-landing", "screen-connecting");

  Signaling.connect(roomCode, data => {
    console.log("Signal received:", data);
    handleSignal(data);
  });

  WebRTC.init(
    data => {
      console.log("Sending signal:", data);
      Signaling.send(data);
    },
    msg => console.log("Message:", msg)
  );

  if (isHost) {
    console.log("Creating offer...");
    WebRTC.createOffer(Signaling.send);
  }
}


    // CREATE ROOM
    createBtn.addEventListener("click", () => {
        const code = generateRoomCode();
        roomInput.value = code;
        joinBtn.disabled = false;

        joinRoom(code, true);
    });
});

/* ============================= */
/* ROOM + CONNECTION LOGIC */
/* ============================= */

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function joinRoom(roomCode, isHost) {
    console.log("Joining room:", roomCode);

    // Update UI
    document.getElementById("display-room-code").textContent = roomCode;
    switchScreen("screen-landing", "screen-connecting");

    // Connect to signaling server
    Signaling.connect(roomCode, handleSignal);

    // Init WebRTC
   WebRTC.init(
  data => Signaling.send(data),
  msg => console.log("Message:", msg),
  () => {
    console.log("✅ WebRTC Connected");
    switchScreen("screen-connecting", "screen-chat");
  }
);

if (isHost) {
  WebRTC.createOffer(Signaling.send, () => {
    console.log("✅ DataChannel Open (Host)");
    switchScreen("screen-connecting", "screen-chat");
  });
}


    if (isHost) {
        WebRTC.createOffer(Signaling.send);
    }
}

function handleSignal(data) {
    if (data.type === "offer") {
        WebRTC.handleOffer(data.offer, Signaling.send);
    }
    if (data.type === "answer") {
        WebRTC.handleAnswer(data.answer);
    }
    if (data.type === "ice") {
        WebRTC.handleIce(data.candidate);
    }
}

/* ============================= */
/* UI HELPERS */
/* ============================= */

function switchScreen(hideId, showId) {
    document.getElementById(hideId)?.classList.remove("active");
    document.getElementById(showId)?.classList.add("active");
}

