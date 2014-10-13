/* Copyright (C) 2013 Tuna Oezer, General AI.
 * All rights reserved.
 */

/**
 * Called when a WebRTC error is encountered. If an error callback has been configured, the
 * error callback is called with the error message. Otherwise, an alert with the error message
 * is shown.
 *
 * @param config The WebRTC configuration.
 * @param message The error message.
 */
function webrtc_reportError(config, message) {
    if (config.onError != null) {
        config.onError(message);
    } else {
        alert(message);
    }
}

/**
 * Creates and returns a default WebRTC configuration object.
 * The ice_servers and p2p_channel_server must be set in the returned configuration, before
 * a WebRTC instance can be called.
 */
function webRtcDefaultConfig() {
    var default_config = {
        // At least one STUN or TURN server must be specified.
        ice_servers: [],

        p2p_channel: null,
        p2p_topic: null,

        remote_video_display: "remote_video",
        local_video_display: null,
        video_width: 320,
        video_height: 240,
        video_frame_rate: 10,

        enable_audio: true,

        onReady: null,
        onConnected: null,
        onTerminated: null,
        onError: null,
    };
    return default_config;
}

/**
 * WebRTC states.
 */
var WebRtcState = {
    INITIALIZED: 1,
    CALLING: 2,
    TERMINATED: 3,
};

/**
 * WebRTC API.
 * webrtc_config can be obtained via webRtcDefaultConfig() and modified.
 *
 * @param webrtc_config Configuration options.
 */
var WebRTC = function(webrtc_config) {
    if (webrtc_config.ice_servers.length == 0) {
        webrtc_reportError(webrtc_config, "No ICE servers specified.");
        return;
    }
    if (webrtc_config.p2p_channel == null ||
        webrtc_config.p2p_topic == null ||
        webrtc_config.p2p_topic.length == 0) {
        webrtc_reportError(webrtc_config, "Invalid P2P specification.");
        return;
    }
    this.webrtc_handler_ = new WebRtcHandler(webrtc_config);
    this.state_ = WebRtcState.INITIALIZED;
};

WebRTC.prototype = {
    /**
     * Waits and listens for incoming connections. Called by calleee.
     */
    listen: function() {
        if (this.state_ != WebRtcState.INITIALIZED) return;
        this.state_ = WebRtcState.CALLING;
        this.webrtc_handler_.listen();
    },

    /**
     * Initiates a call to a listening client. Called by caller.
     */
    call: function() {
        if (this.state_ != WebRtcState.INITIALIZED) return;
        this.state_ = WebRtcState.CALLING;
        this.webrtc_handler_.call();
    },

    /**
     * Terminates an ongoing call. Called by both caller or callee.
     */
    hangup: function() {
        if (this.state_ != WebRtcState.CALLING) return;
        this.state_ = WebRtcState.TERMINATED;
        this.webrtc_handler_.hangup();
    },
};

/**
 * WebRTC API implementation.
 * WebRtcHandler is an internal class. The WebRTC class declared above defines the public API.
 *
 * @param webrtc_config Configuration options.
 */
var WebRtcHandler = function(webrtc_config) {
    this.webrtc_config_ = webrtc_config;
    this.p2p_channel_ = webrtc_config.p2p_channel;
    this.p2p_subscribed_ = false;
    this.p2p_connection_ = null;
    this.remote_video_display_ = null;
    this.local_video_display_ = null,
    this.sdp_constraints_ = {
        mandatory: {
            OfferToReceiveAudio: webrtc_config.enable_audio,
            OfferToReceiveVideo: true,
        }
    };
    this.p2p_config_ = {iceServers: webrtc_config.ice_servers};
    this.p2p_constraints_ = {optional: [{ DtlsSrtpKeyAgreement: true }]};
    this.offer_constraints_ = {mandatory: {}, optional: []};
    this.media_constraints_ = {
        audio: webrtc_config.enable_audio,
        video: {
            mandatory: {
                maxWidth: webrtc_config.video_width,
                maxHeight: webrtc_config.video_height,
                maxFrameRate: webrtc_config.video_frame_rate,
            },
            optional: []
        }
    };
    this.do_call_ = false;
    this.local_stream_ = null;
};

WebRtcHandler.prototype = {
    //--------------------------------------------------------------------------
    // internal methods to be used by other objects in this file
    //--------------------------------------------------------------------------

    /**
     * Waits and listens for incoming connections.
     */
    listen: function() {
        this.do_call_ = false;
        this.initialize();
    },

    /**
     * Initiates a call using the P2P channel.
     */
    call: function() {
        this.do_call_ = true;
        this.initialize();
    },

    /**
     * Terminates a call in progress.
     */
    hangup: function() {
        this.send({ type: "bye" });
        this.doHangup();
    },

    //--------------------------------------------------------------------------
    // private methods
    //--------------------------------------------------------------------------

    /**
     * Initial method called to setup a WebRTC connection.
     * Initializes state, subscribes to P2P channel, and initiates access to user media.
     */
    initialize: function() {
        this.remote_video_display_ =
            document.getElementById(this.webrtc_config_.remote_video_display);
        if (this.webrtc_config_.local_video_display != null) {
            this.local_video_display_ =
                document.getElementById(this.webrtc_config_.local_video_display);
        }

        this.p2p_channel_.subscribe(this.webrtc_config_.p2p_topic,
                                    this.onChannelMessage.bind(this));
        this.p2p_subscribed_ = true;

        try {
            getUserMedia(this.media_constraints_,
                         this.onUserMediaSuccess.bind(this),
                         this.onUserMediaError.bind(this));
        } catch (e) {
            webrtc_reportError(this.webrtc_config_, "getUserMedia() is not supported.");
        }
    },

    /**
     * Handles incoming P2P messages. Typically used to communicate control messages.
     *
     * @param topic The P2P topic.
     * @param message The control message.
     */
    onChannelMessage: function(topic, message) {
        var p2p_message = JSON.parse(message);
        if (p2p_message.type === "offer") {
            this.p2p_connection_.setRemoteDescription(new RTCSessionDescription(p2p_message));
            this.p2p_connection_.createAnswer(
                this.setLocalAndSend.bind(this),
                null,
                this.sdp_constraints_);
        } else if (p2p_message.type === "answer") {
            this.p2p_connection_.setRemoteDescription(new RTCSessionDescription(p2p_message));
        } else if (p2p_message.type === "candidate") {
            var candidate = new RTCIceCandidate({
                sdpMLineIndex: p2p_message.label,
                candidate: p2p_message.candidate
            });
            this.p2p_connection_.addIceCandidate(candidate);
        } else if (p2p_message.type === "bye") {
            this.onRemoteHangup();
        }
    },

    /**
     * Handles successful access to user media.
     *
     * @param stream The local media stream.
     */
    onUserMediaSuccess: function(stream) {
        this.local_stream_ = stream;
        this.addLocalStream();
        this.createP2PConnection();
        if (this.p2p_connection_ == null) return;
        this.p2p_connection_.addStream(stream);
        if (this.do_call_) this.doCall();
        if (this.webrtc_config_.onReady != null) {
            this.webrtc_config_.onReady();
        }
    },

    /**
     * Handles a user media access error.
     *
     * @param error The error details.
     */
    onUserMediaError: function(error) {
        webrtc_reportError(this.webrtc_config_, "Failed to get access to local media.");
    },

    /**
     * Creates a WebRTC P2P connection.
     */
    createP2PConnection: function() {
        try {
            this.p2p_connection_ = new RTCPeerConnection(this.p2p_config_, this.p2p_constraints_);
            this.p2p_connection_.onicecandidate = this.onIceCandidate.bind(this);
            this.p2p_connection_.onaddstream = this.onRemoteStreamAdded.bind(this);
            this.p2p_connection_.onremovestream = this.onRemoteStreamRemoved.bind(this);
        } catch (e) {
            webrtc_reportError(this.webrtc_config_, "WebRTC P2P connection is not supported.");
            this.p2p_connection_ = null;
        }
    },

    /**
     * Handles ICE candidate events.
     *
     * @param event ICE candidate information.
     */
    onIceCandidate: function(event) {
        if (event.candidate) {
            this.send({
                type: "candidate",
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate.candidate
	    });
        }
    },

    /**
     * Enables the local media stream and makes it visible in the UI.
     */
    addLocalStream: function() {
        if (this.local_video_display_ != null) {
            attachMediaStream(this.local_video_display_, this.local_stream_);
        }
    },

    /**
     * Disables the local media stream and hides it from the UI.
     */
    removeLocalStream: function() {
        if (this.local_video_display_ != null) {
            detachMediaStream(this.local_video_display_);
        }
    },

    /**
     * Handles the start of a remote media stream.
     *
     * @param event Remote media stream.
     */
    onRemoteStreamAdded: function(event) {
        if (this.remote_video_display_ != null) {
            attachMediaStream(this.remote_video_display_, event.stream);
        }
        if (this.webrtc_config_.onConnected != null) {
            this.webrtc_config_.onConnected();
        }
    },

    /**
     * Handles the end of a remote media stream.
     *
     * @param event Remote media stream.
     */
    onRemoteStreamRemoved: function(event) {
        if (this.remote_video_display_ != null) {
            detachMediaStream(this.remote_video_display);
        }
    },

    /**
     * Initiates a WebRTC call by sending an offer over the P2P channel.
     */
    doCall: function() {
        var constraints = this.mergeConstraints(this.offer_constraints_, this.sdp_constraints_);
        this.p2p_connection_.createOffer(this.setLocalAndSend.bind(this), null, constraints);
    },

    /**
     * Handles remote hangup events.
     */
    onRemoteHangup: function() {
        this.doHangup();
    },

    /**
     * Terminates a WebRTC call. Can be safely called in any state.
     */
    doHangup: function() {
        if (this.p2p_connection_ != null) {
            this.p2p_connection_.close();
            this.p2p_connection_ = null;
        }
        if (this.p2p_subscribed_) {
            this.p2p_channel_.unsubscribe(this.webrtc_config_.p2p_topic);
            this.p2p_subscribed_ = false;
        }
        if (this.local_stream_ != null) {
            this.removeLocalStream();
            this.local_stream_.stop();
        }
        if (this.webrtc_config_.onTerminated != null) {
            this.webrtc_config_.onTerminated();
        }
    },

    /**
     * Updates the local WebRTC session description and send it to the remote endpoint.
     *
     * @param session_description Updated WebRTC session description.
     */
    setLocalAndSend: function(session_description) {
        this.p2p_connection_.setLocalDescription(session_description);
        this.send(session_description);
    },

    /**
     * Sends a message over the P2P channel to the remote endpoint.
     *
     * @param p2p_message Message to be sent.
     */
    send: function(p2p_message) {
        var message = JSON.stringify(p2p_message);
        this.p2p_channel_.publish(this.webrtc_config_.p2p_topic, message);
    },

    /**
     * Merges two WebRTC constraint objects and returns the merged object.
     *
     * @param constraint_1 The first constraint object.
     * @param constraint_2 The second constraint object.
     * @return The merged constraint object.
     */
    mergeConstraints: function(constraints_1, constraints_2) {
        var merged = constraints_1;
        for (var name in constraints_2.mandatory) {
            merged.mandatory[name] = constraints_2.mandatory[name];
        }
        merged.optional.concat(constraints_2.optional);
        return merged;
    },
};
