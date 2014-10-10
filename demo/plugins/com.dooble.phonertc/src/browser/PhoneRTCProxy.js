cordova.define("com.dooble.phonertc.PhoneRTCProxy", function(require, exports, module) { var PeerConnection = window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
var IceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;
var SessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;

function Session(config, sendMessageCallback) {
  var self = this;
  self.config = config;
  self.sendMessage = sendMessageCallback;

  self.onIceCandidate = function (event) {
    if (event.candidate) {
      self.sendMessage({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate
      });
    }
  };

  self.onRemoteStreamAdded = function (event) {
    addRemoteStream(event.stream);
  };

  self.setRemote = function (message) {
    message.sdp = self.addCodecParam(message.sdp, 'opus/48000', 'stereo=1');

    self.peerConnection.setRemoteDescription(new SessionDescription(message), function () {
      console.log('setRemote success');
    }, function (error) { 
      console.log(error); 
    });
  };

  // Adds fmtp param to specified codec in SDP.
  self.addCodecParam = function (sdp, codec, param) {
    var sdpLines = sdp.split('\r\n');

    // Find opus payload.
    var index = self.findLine(sdpLines, 'a=rtpmap', codec);
    var payload;
    if (index) {
      payload = self.getCodecPayloadType(sdpLines[index]);
    }

    // Find the payload in fmtp line.
    var fmtpLineIndex = self.findLine(sdpLines, 'a=fmtp:' + payload.toString());
    if (fmtpLineIndex === null) {
      return sdp;
    }

    sdpLines[fmtpLineIndex] = sdpLines[fmtpLineIndex].concat('; ', param);

    sdp = sdpLines.join('\r\n');
    return sdp;
  };

  // Find the line in sdpLines that starts with |prefix|, and, if specified,
  // contains |substr| (case-insensitive search).
  self.findLine = function (sdpLines, prefix, substr) {
    return self.findLineInRange(sdpLines, 0, -1, prefix, substr);
  };

  // Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
  // and, if specified, contains |substr| (case-insensitive search).
  self.findLineInRange = function (sdpLines, startLine, endLine, prefix, substr) {
    var realEndLine = endLine !== -1 ? endLine : sdpLines.length;
    for (var i = startLine; i < realEndLine; ++i) {
      if (sdpLines[i].indexOf(prefix) === 0) {
        if (!substr ||
            sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1) {
          return i;
        }
      }
    }
    return null;
  };

  // Gets the codec payload type from an a=rtpmap:X line.
  self.getCodecPayloadType = function (sdpLine) {
    var pattern = new RegExp('a=rtpmap:(\\d+) \\w+\\/\\d+');
    var result = sdpLine.match(pattern);
    return (result && result.length === 2) ? result[1] : null;
  };

  // Returns a new m= line with the specified codec as the first one.
  self.setDefaultCodec = function (mLine, payload) {
    var elements = mLine.split(' ');
    var newLine = [];
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
      if (index === 3) { // Format of media starts from the fourth.
        newLine[index++] = payload; // Put target payload to the first.
      }
      if (elements[i] !== payload) {
        newLine[index++] = elements[i];
      }
    }
    return newLine.join(' ');
  };
}

Session.prototype.call = function () {
  var self = this;
  navigator.getUserMedia(self.config.streams, function (stream) {
    // create the peer connection
    self.peerConnection = new PeerConnection({
      iceServers: [
        { 
          url: 'stun:stun.l.google.com:19302' 
        },
        { 
          url: self.config.turn.host, 
          username: self.config.turn.username, 
          password: self.config.turn.password 
        }
      ]
    }, { optional: [ { DtlsSrtpKeyAgreement: true } ]});

    self.peerConnection.onicecandidate = self.onIceCandidate;
    self.peerConnection.onaddstream = self.onRemoteStreamAdded;

    // attach the stream to the peer connection
    self.peerConnection.addStream(stream);

    // if initiator - create offer
    if (self.config.isInitiator) {
      self.peerConnection.createOffer(function (sdp) {
        self.peerConnection.setLocalDescription(sdp, function () {
          console.log('Set session description success.');
        }, function (error) {
          console.log(error);
        });

        self.sendMessage(sdp);
      }, function (error) {
        console.log(error);
      }, { mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: !!videoConfig }});
    }
  }, function (error) {
    console.log(error);
  });
};

Session.prototype.receiveMessage = function (message) {
  var self = this;
  if (message.type === 'offer') {
    self.setRemote(message);
    self.peerConnection.createAnswer(function (sdp) {
      self.peerConnection.setLocalDescription(sdp, function () {
        console.log('Set session description success.');
      }, function (error) {
        console.log(error);
      });

      self.sendMessage(sdp);
    }, function (error) {
      console.log(error);
    }, { mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: !!videoConfig }});
  } else if (message.type === 'answer') {
    self.setRemote(message);
  } else if (message.type === 'candidate') {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    
    self.peerConnection.addIceCandidate(candidate, function () {
      console.log('Remote candidate added successfully.');
    }, function (error) {
      console.log(error);
    });
     
  } else if (message.type === 'bye') {
    console.log('disconnect');
  }
};

Session.prototype.disconnect = function () {
  // TODO
};


var sessions = {};
var videoConfig;
var localVideoView;
var remoteVideoViews = [];

module.exports = {
  createSessionObject: function (success, error, options) {
    var sessionKey = uuid();
    var session = new Session(options[0], success);

    session.sendMessage({
      type: '__set_session_key',
      sessionKey: sessionKey
    });

    sessions[sessionKey] = session;
  },
  call: function (success, error, options) {
    sessions[options[0].sessionKey].call();
  },
  receiveMessage: function (success, error, options) {
    sessions[options[0].sessionKey]
      .receiveMessage(JSON.parse(options[0].message));
  },
  disconnect: function (success, error, options) {
    sessions[options[0].sessionKey].disconnect();
  },
  setVideoView: function (success, error, options) {
    videoConfig = options[0];

    if (videoConfig.containerParams.size[0] === 0 
        || videoConfig.containerParams.size[1] === 0) {
      return;
    }

    if (videoConfig.local) {
      if (!localVideoView) {
        localVideoView = document.createElement('video');
        localVideoView.autoplay = true;
        localVideoView.muted = true;
        localVideoView.style.position = 'absolute';
        localVideoView.style.zIndex = 999;
        localVideoView.addEventListener("loadedmetadata", scaleToFill);

        refreshLocalVideoView();

        navigator.getUserMedia({ audio: false, video: true }, function (stream) {
          localVideoView.src = URL.createObjectURL(stream);
          localVideoView.load();
        }, function (error) {
          console.log(error);
        });

        document.body.appendChild(localVideoView);
      } else {    
        refreshLocalVideoView();
        refreshVideoContainer();
      }
    }
  }
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function addRemoteStream(stream) {
  var videoView = document.createElement('video');
  videoView.autoplay = true;
  videoView.addEventListener("loadedmetadata", scaleToFill);
  videoView.style.position = 'absolute';
  videoView.style.zIndex = 998;

  videoView.src = URL.createObjectURL(stream);
  videoView.load();

  remoteVideoViews.push(videoView);
  document.body.appendChild(videoView);

  refreshVideoContainer();
}

function refreshVideoContainer() {
  var n = remoteVideoViews.length;

  if (n === 0) {
    return;
  }

  var totalArea = videoConfig.containerParams.size[0] * videoConfig.containerParams.size[1];
  var videoSize = Math.sqrt(totalArea / n);

  var videosInRow = videoConfig.containerParams.size[0] / videoSize;
  var rows = Math.ceil(n / videosInRow);

  var x = videoConfig.containerParams.position[0];
  var y = videoConfig.containerParams.position[1];

  var videoViewIndex = 0;

  for (var row = 0; row < rows; row++) {
    for (var video = 0; video < videosInRow; video++) {
      var videoView = remoteVideoViews[videoViewIndex++];
      videoView.style.width = videoSize + 'px';
      videoView.style.height = videoSize + 'px';

      videoView.style.left = x + 'px';
      videoView.style.top = y + 'px';

      x += videoSize;
    }

    y += videoSize;
  }
}

function refreshLocalVideoView() {
  localVideoView.style.width = videoConfig.local.size[0] + 'px';
  localVideoView.style.height = videoConfig.local.size[1] + 'px';

  localVideoView.style.left = 
    (videoConfig.containerParams.position[0] + videoConfig.local.position[0]) + 'px';

  localVideoView.style.top = 
    (videoConfig.containerParams.position[1] + videoConfig.local.position[1]) + 'px';       
}

function scaleToFill(event) {
  var element = this;
  var targetRatio = element.offsetWidth / element.offsetHeight;
  var lastScaleType, lastAdjustmentRatio;

  function refreshTransform () {
    var widthIsLargerThanHeight = element.videoWidth > element.videoHeight;
    var actualRatio = element.videoWidth / element.videoHeight;

    var scaleType = widthIsLargerThanHeight ? 'scaleY' : 'scaleX';
    var adjustmentRatio = widthIsLargerThanHeight ? 
      actualRatio / targetRatio : 
      targetRatio / actualRatio ; 

    if (lastScaleType !== scaleType || lastAdjustmentRatio !== adjustmentRatio) {
      var transform = scaleType + '(' + adjustmentRatio + ')';
      
      element.style.webkitTransform = transform;
      element.style.MozTransform = transform;
      element.style.msTransform = transform;
      element.style.OTransform = transform;
      element.style.transform = transform;

      lastScaleType = scaleType;
      lastAdjustmentRatio = adjustmentRatio;
    }

    setTimeout(refreshTransform, 100);
  }

  refreshTransform();
}
require("cordova/exec/proxy").add("PhoneRTCPlugin", module.exports);
});