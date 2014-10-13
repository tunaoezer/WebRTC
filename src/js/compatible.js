/* Copyright (C) 2013 Tuna Oezer, General AI.
 * All rights reserved.
 */

var RTCPeerConnection = null;
var getUserMedia = null;
var attachMediaStream = null;
var detachMediaStream = null;

// Unifies various API methods across browsers.
if (navigator.mozGetUserMedia) {
    // Firefox
    RTCPeerConnection = mozRTCPeerConnection;
    getUserMedia = navigator.mozGetUserMedia.bind(navigator);
    RTCSessionDescription = mozRTCSessionDescription;
    RTCIceCandidate = mozRTCIceCandidate;
    attachMediaStream = function(element, stream) {
        element.mozSrcObject = stream;
    };
    detachMediaStream = function(element) {
        element.mozSrcObject = null;
    };
    MediaStream.prototype.getVideoTracks = function() {
        return [];
    };
    MediaStream.prototype.getAudioTracks = function() {
        return [];
    };
} else if (navigator.webkitGetUserMedia) {
    // Chrome
    RTCPeerConnection = webkitRTCPeerConnection;
    getUserMedia = navigator.webkitGetUserMedia.bind(navigator);
    attachMediaStream = function(element, stream) {
        element.src = webkitURL.createObjectURL(stream);
        element.play();
    };
    detachMediaStream = function(element) {
        element.src = null;
    };
} else {
    alert("WebRTC is not supported by this browser.");
}
