/* Copyright (C) 2013 Tuna Oezer, General AI.
 * All rights reserved.
 */

/**
 * Implements a WAMP communications channel. All communication to the WAMP user service is
 * directed through this channel. Channel allows making RPC calls to the user service and
 * provides access to the pub/sub service.
 *
 * The browser session associated with this channel must have been logged in as the specified
 * username.
 *
 * @param username The username with which this channel is associated.
 * @param user_session_id The ID of the session under which the user is logged in.
 */
var Channel = function(username, user_session_id) {
    this.username_ = username;
    this.user_session_id_ = user_session_id;
    this.session_ = null;
};

Channel.prototype = {
    /**
     * Opens the channel.
     *
     * @param open_callback Executed when the channel is opened.
     * @param close_callback Executed when the channel is closed.
     */
    open: function(open_callback, close_callback) {
        open_callback = typeof open_callback === "undefined" ? null : open_callback;
        close_callback = typeof close_callback === "undefined" ? null : close_callback;
        if (this.session_ != null) return;
        var self = this;
        var protocol = window.location.protocol.indexOf("https") === 0 ? "wss://" : "ws://";
        var server_address = protocol + window.location.host +
            "/interbot/user/user_service.wamp?username=" + this.username_ +
            "&session_id=" + this.user_session_id_;
        ab.connect(server_address,
                   function(session) {
                       self.session_ = session;
                       session.prefix("event", "wamp://" +
                                      encodeURIComponent(self.username_) +
                                      "@general.ai/events/");
                       session.prefix("rpc", "wamp://" +
                                      encodeURIComponent(self.username_) +
                                      "@general.ai/bin/");
                       if (open_callback != null) {
                           open_callback();
                       }
                   },
                   function(code, reason) {
                       self.session_ = null;
                       if (close_callback != null) {
                           close_callback(code, reason);
                       }
                   });
    },

    /**
     * Closes the channel.
     */
    close: function() {
        if (this.session_ == null) return;
        this.session_.close();
        this.session_ = null;
    },

    /**
     * Returns true if the channel is open.
     *
     * @return True if the channel is open.
     */
    isOpen: function() {
        return this.session_ != null;
    },

    /**
     * Subscribes to the specified topic.
     *
     * @param topic URI of topic.
     * @param event_handler Callback method to call when an event for the topic is received.
     */
    subscribe: function(topic, event_handler) {
        if (this.session_ == null) return;
        this.session_.subscribe(topic, event_handler);
    },

    /**
     * Unsubscribes from a subscribed topic.
     *
     * @param topic URI of topic.
     */
    unsubscribe: function(topic) {
        if (this.session_ == null) return;
        this.session_.unsubscribe(topic);
    },

    /**
     * Publishes an event to the specified topic.
     * The channel will receive any published topics to which it is subscribed unless exclude_me
     * is true. By default exclude_me is true.
     *
     * @param topic URI of topic.
     * @param data The event data to publish.
     * @param exclude_me If true do not send back event if subscribed to topic. Default is true.
     */
    publish: function(topic, data, exlude_me) {
        if (this.session_ == null) return;
        exclude_me = typeof exclude_me === "undefined" ? true : exclude_me;
        this.session_.publish(topic, data, exclude_me);
    },

    /**
     * Make an RPC call. This method takes at least one implicit argument which is the RPC URI.
     * This method returns immediately. The RPC call is made asynchronously.
     * This method returns a 'then' continuation that can be optionally used to execute a callback
     * when the RPC completes. To register a callback, use the form:
     *   call(method, args).then(callback);
     *
     * @param uri The RPC method URI.
     * @param args The arguments to the RPC method.
     * @return 'then' continuation method that is executed when the call returns.
     */
    call: function(/* uri, args... */) {
        if (this.session_ == null) return {then: function(callback) { callback(false); }};
        return this.session_.call.apply(this.session_, arguments);
    },
};
