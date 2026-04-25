#include <napi.h>
#include <uv.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <linux/can.h>
#include <linux/can/raw.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstring>
#include <cerrno>

// Open a PF_CAN raw socket bound to the given interface in non-blocking mode.
// Both reads and writes use non-blocking I/O so the libuv threadpool is never
// occupied by a blocking syscall — this allows process.exit() to terminate
// cleanly even when no CAN traffic is flowing.
static int OpenAndBindCanSocket(const std::string& ifname, std::string& err) {
  int fd = socket(PF_CAN, SOCK_RAW, CAN_RAW);
  if (fd < 0) {
    err = std::string("socket(PF_CAN): ") + strerror(errno);
    return -1;
  }

  struct ifreq ifr;
  std::memset(&ifr, 0, sizeof(ifr));
  std::strncpy(ifr.ifr_name, ifname.c_str(), IFNAMSIZ - 1);
  if (ioctl(fd, SIOCGIFINDEX, &ifr) < 0) {
    err = std::string("ioctl(SIOCGIFINDEX) for '") + ifname +
          "': " + strerror(errno);
    close(fd);
    return -1;
  }

  struct sockaddr_can addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.can_family = AF_CAN;
  addr.can_ifindex = ifr.ifr_ifindex;
  if (bind(fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
    err = std::string("bind() to '") + ifname + "': " + strerror(errno);
    close(fd);
    return -1;
  }

  if (fcntl(fd, F_SETFL, O_NONBLOCK) < 0) {
    err = std::string("fcntl(O_NONBLOCK) for '") + ifname +
          "': " + strerror(errno);
    close(fd);
    return -1;
  }

  return fd;
}

Napi::Value OpenCanReadSocket(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Interface name required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string ifname = info[0].As<Napi::String>().Utf8Value();
  std::string err;
  int fd = OpenAndBindCanSocket(ifname, err);
  if (fd < 0) {
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Number::New(env, fd);
}

Napi::Value OpenCanWriteSocket(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Interface name required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string ifname = info[0].As<Napi::String>().Utf8Value();
  std::string err;
  int fd = OpenAndBindCanSocket(ifname, err);
  if (fd < 0) {
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Disable reception on the write-only socket — empty filter array tells
  // the kernel not to deliver incoming frames to this socket's receive
  // buffer, avoiding wasted copies.
  if (setsockopt(fd, SOL_CAN_RAW, CAN_RAW_FILTER, NULL, 0) < 0) {
    std::string msg = std::string("setsockopt(CAN_RAW_FILTER) for '") +
                      ifname + "': " + strerror(errno);
    close(fd);
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // NOTE: CAN_RAW_LOOPBACK is left at its default (enabled). On virtual CAN
  // (vcan) interfaces the kernel uses loopback to distribute frames between
  // sockets bound to the same interface — disabling it would cause write()
  // to succeed silently while no other socket (including candump or peers
  // on the bus) ever sees the frame.

  return Napi::Number::New(env, fd);
}

Napi::Value WriteCanFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "writeCanFrame(fd, buffer) expected")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int fd = info[0].As<Napi::Number>().Int32Value();
  Napi::Buffer<uint8_t> buf = info[1].As<Napi::Buffer<uint8_t>>();
  ssize_t written = write(fd, buf.Data(), buf.Length());
  if (written < 0) {
    return Napi::Number::New(env, -errno);
  }
  return Napi::Number::New(env, static_cast<int>(written));
}

// Drain all currently-readable frames from the non-blocking fd into an
// array of Buffers, returned to JS. Returns an empty array if no frames
// are available (EAGAIN). This is called from the JS-side poll callback
// when the fd becomes readable.
Napi::Value ReadCanFrames(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "readCanFrames(fd) expected")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int fd = info[0].As<Napi::Number>().Int32Value();

  Napi::Array out = Napi::Array::New(env);
  uint32_t idx = 0;
  uint8_t buf[sizeof(struct can_frame)];

  while (true) {
    ssize_t n = read(fd, buf, sizeof(buf));
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        break;
      }
      Napi::Error::New(env, std::string("read: ") + strerror(errno))
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (n == 0) {
      break;
    }
    out.Set(idx++, Napi::Buffer<uint8_t>::Copy(env, buf, n));
  }

  return out;
}

// CanPoller: wraps a uv_poll_t on a CAN read fd, calls a JS callback when
// frames are readable. Closing the poller is synchronous and prevents any
// further callbacks; the underlying fd is the caller's responsibility.
class CanPoller : public Napi::ObjectWrap<CanPoller> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(
        env, "CanPoller",
        {InstanceMethod("close", &CanPoller::Close)});
    exports.Set("CanPoller", func);
    return exports;
  }

  CanPoller(const Napi::CallbackInfo& info) : Napi::ObjectWrap<CanPoller>(info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
      Napi::TypeError::New(env, "new CanPoller(fd, callback)")
          .ThrowAsJavaScriptException();
      return;
    }
    fd_ = info[0].As<Napi::Number>().Int32Value();
    callback_.Reset(info[1].As<Napi::Function>(), 1);
    closed_ = false;

    uv_loop_t* loop = nullptr;
    napi_get_uv_event_loop(env, &loop);
    poll_ = new uv_poll_t;
    poll_->data = this;
    int rc = uv_poll_init(loop, poll_, fd_);
    if (rc < 0) {
      delete poll_;
      poll_ = nullptr;
      Napi::Error::New(env,
                       std::string("uv_poll_init: ") + uv_strerror(rc))
          .ThrowAsJavaScriptException();
      return;
    }
    rc = uv_poll_start(poll_, UV_READABLE, &CanPoller::OnPoll);
    if (rc < 0) {
      uv_close(reinterpret_cast<uv_handle_t*>(poll_), &CanPoller::OnClose);
      poll_ = nullptr;
      Napi::Error::New(env,
                       std::string("uv_poll_start: ") + uv_strerror(rc))
          .ThrowAsJavaScriptException();
      return;
    }
  }

  ~CanPoller() {
    // poll_ should already be null after Close(); if not, the object was
    // GC'd without explicit close — schedule a libuv close to clean up.
    if (poll_ != nullptr && !closed_) {
      closed_ = true;
      uv_poll_stop(poll_);
      uv_close(reinterpret_cast<uv_handle_t*>(poll_), &CanPoller::OnClose);
      poll_ = nullptr;
    }
  }

 private:
  static void OnPoll(uv_poll_t* handle, int status, int events) {
    CanPoller* self = static_cast<CanPoller*>(handle->data);
    if (self->closed_ || status < 0 || !(events & UV_READABLE)) {
      return;
    }
    Napi::Env env = self->callback_.Env();
    Napi::HandleScope scope(env);
    self->callback_.Call({});
  }

  static void OnClose(uv_handle_t* handle) {
    delete reinterpret_cast<uv_poll_t*>(handle);
  }

  Napi::Value Close(const Napi::CallbackInfo& info) {
    if (!closed_ && poll_ != nullptr) {
      closed_ = true;
      uv_poll_stop(poll_);
      uv_close(reinterpret_cast<uv_handle_t*>(poll_), &CanPoller::OnClose);
      poll_ = nullptr;
      callback_.Reset();
    }
    return info.Env().Undefined();
  }

  int fd_ = -1;
  uv_poll_t* poll_ = nullptr;
  bool closed_ = true;
  Napi::FunctionReference callback_;
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("openCanReadSocket", Napi::Function::New(env, OpenCanReadSocket));
  exports.Set("openCanWriteSocket",
              Napi::Function::New(env, OpenCanWriteSocket));
  exports.Set("writeCanFrame", Napi::Function::New(env, WriteCanFrame));
  exports.Set("readCanFrames", Napi::Function::New(env, ReadCanFrames));
  CanPoller::Init(env, exports);
  return exports;
}

NODE_API_MODULE(canSocket, Init)
