#include <napi.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <linux/can.h>
#include <linux/can/raw.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstring>
#include <cerrno>

static Napi::Value OpenCanSocketImpl(const Napi::CallbackInfo& info, bool nonblock) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Interface name required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string ifname = info[0].As<Napi::String>().Utf8Value();

  int fd = socket(PF_CAN, SOCK_RAW, CAN_RAW);
  if (fd < 0) {
    Napi::Error::New(env, std::string("socket(PF_CAN): ") + strerror(errno))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  struct ifreq ifr;
  std::memset(&ifr, 0, sizeof(ifr));
  std::strncpy(ifr.ifr_name, ifname.c_str(), IFNAMSIZ - 1);
  if (ioctl(fd, SIOCGIFINDEX, &ifr) < 0) {
    std::string err = std::string("ioctl(SIOCGIFINDEX) for '") + ifname +
                      "': " + strerror(errno);
    close(fd);
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  struct sockaddr_can addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.can_family = AF_CAN;
  addr.can_ifindex = ifr.ifr_ifindex;
  if (bind(fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
    std::string err =
        std::string("bind() to '") + ifname + "': " + strerror(errno);
    close(fd);
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (nonblock) {
    if (fcntl(fd, F_SETFL, O_NONBLOCK) < 0) {
      std::string err =
          std::string("fcntl(O_NONBLOCK) for '") + ifname + "': " + strerror(errno);
      close(fd);
      Napi::Error::New(env, err).ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  return Napi::Number::New(env, fd);
}

Napi::Value OpenCanSocket(const Napi::CallbackInfo& info) {
  return OpenCanSocketImpl(info, false);
}

Napi::Value OpenCanSocketNonBlock(const Napi::CallbackInfo& info) {
  return OpenCanSocketImpl(info, true);
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("openCanSocket", Napi::Function::New(env, OpenCanSocket));
  exports.Set("openCanSocketNonBlock", Napi::Function::New(env, OpenCanSocketNonBlock));
  exports.Set("writeCanFrame", Napi::Function::New(env, WriteCanFrame));
  return exports;
}

NODE_API_MODULE(canSocket, Init)
