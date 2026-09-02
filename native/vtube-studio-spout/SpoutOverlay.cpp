#include <windows.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>
#include <vector>

#include "Spout.h"

extern "C" {
__declspec(dllexport) DWORD NvOptimusEnablement = 0x00000001;
__declspec(dllexport) int AmdPowerXpressRequestHighPerformance = 1;
}

namespace {

constexpr wchar_t kWindowClassName[] = L"FpnfVTubeStudioSpoutOverlay";
constexpr UINT_PTR kFrameTimer = 1;
constexpr UINT kMinimumFps = 15;
constexpr UINT kMaximumFps = 60;
constexpr int kWidgetSafeAreaHeight = 128;
constexpr float kExpandedChatMinimumAspect = 0.95F;

struct Options {
  HWND owner = nullptr;
  std::string sender = "VTubeStudioSpout";
  UINT fps = 30;
  float zoom = 1.0F;
};

struct DibSurface {
  HDC dc = nullptr;
  HBITMAP bitmap = nullptr;
  HGDIOBJ previous = nullptr;
  std::uint8_t* pixels = nullptr;
  int width = 0;
  int height = 0;

  void reset() {
    if (dc && previous) SelectObject(dc, previous);
    if (bitmap) DeleteObject(bitmap);
    if (dc) DeleteDC(dc);
    dc = nullptr;
    bitmap = nullptr;
    previous = nullptr;
    pixels = nullptr;
    width = 0;
    height = 0;
  }

  bool resize(int next_width, int next_height) {
    if (next_width == width && next_height == height && pixels) return true;
    reset();

    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = next_width;
    info.bmiHeader.biHeight = -next_height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;

    dc = CreateCompatibleDC(nullptr);
    if (!dc) return false;
    bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS,
                              reinterpret_cast<void**>(&pixels), nullptr, 0);
    if (!bitmap || !pixels) {
      reset();
      return false;
    }
    previous = SelectObject(dc, bitmap);
    width = next_width;
    height = next_height;
    return true;
  }

  ~DibSurface() { reset(); }
};

struct OverlayState {
  Options options;
  Spout receiver;
  bool owns_opengl_context = false;
  std::vector<std::uint8_t> source_pixels;
  unsigned int source_width = 0;
  unsigned int source_height = 0;
  unsigned int consecutive_source_failures = 0;
  unsigned int consecutive_frame_failures = 0;
  bool source_failure_reported = false;
  bool frame_failure_reported = false;
  bool ready_reported = false;
  DibSurface target;

  ~OverlayState() {
    receiver.ReleaseReceiver();
    if (owns_opengl_context) receiver.CloseOpenGL();
  }
};

void emit_diagnostic(const char* event) {
  std::fprintf(stderr, "%s\n", event);
  std::fflush(stderr);
}

bool parse_unsigned(const wchar_t* value, unsigned long long& parsed) {
  if (!value || !*value) return false;
  wchar_t* end = nullptr;
  errno = 0;
  const auto result = std::wcstoull(value, &end, 10);
  if (errno != 0 || !end || *end != L'\0') return false;
  parsed = result;
  return true;
}

bool is_valid_sender(const std::string& sender) {
  constexpr char prefix[] = "VTubeStudioSpout";
  if (sender.rfind(prefix, 0) != 0) return false;
  if (sender.size() == sizeof(prefix) - 1) return true;
  if (sender.size() > sizeof(prefix) + 2) return false;
  for (std::size_t index = sizeof(prefix) - 1; index < sender.size(); ++index) {
    if (sender[index] < '0' || sender[index] > '9') return false;
  }
  return true;
}

bool narrow_ascii(const wchar_t* input, std::string& output) {
  if (!input) return false;
  output.clear();
  for (const wchar_t* current = input; *current; ++current) {
    if (*current < 0x20 || *current > 0x7e) return false;
    output.push_back(static_cast<char>(*current));
  }
  return !output.empty() && output.size() <= 128;
}

bool parse_options(int count, wchar_t** values, Options& options) {
  for (int index = 1; index < count; ++index) {
    const std::wstring argument(values[index]);
    if (argument == L"--owner" && index + 1 < count) {
      unsigned long long handle = 0;
      if (!parse_unsigned(values[++index], handle) || handle == 0 ||
          handle > static_cast<unsigned long long>(std::numeric_limits<std::uintptr_t>::max())) {
        return false;
      }
      options.owner = reinterpret_cast<HWND>(static_cast<std::uintptr_t>(handle));
    } else if (argument == L"--sender" && index + 1 < count) {
      if (!narrow_ascii(values[++index], options.sender)) return false;
    } else if (argument == L"--fps" && index + 1 < count) {
      unsigned long long fps = 0;
      if (!parse_unsigned(values[++index], fps) || fps < kMinimumFps || fps > kMaximumFps) {
        return false;
      }
      options.fps = static_cast<UINT>(fps);
    } else if (argument == L"--zoom" && index + 1 < count) {
      wchar_t* end = nullptr;
      const auto zoom = std::wcstof(values[++index], &end);
      if (!end || *end != L'\0' || !std::isfinite(zoom) || zoom < 0.5F || zoom > 3.0F) {
        return false;
      }
      options.zoom = zoom;
    } else {
      return false;
    }
  }
  return options.owner && IsWindow(options.owner) && is_valid_sender(options.sender);
}

bool initialize_spout(OverlayState& state) {
  char sender_adapter[256]{};
  if (state.receiver.GetSenderAdapter(state.options.sender.c_str(), sender_adapter,
                                      sizeof(sender_adapter)) >= 0) {
    emit_diagnostic("FPNF_SPOUT_SENDER_ADAPTER_FOUND");
  }
  state.receiver.SetPreferredAdapter(2);
  state.receiver.SetAutoShare(true);
  if (!state.receiver.CreateOpenGL()) return false;
  state.owns_opengl_context = true;
  state.receiver.SetReceiverName(state.options.sender.c_str());
  return true;
}

bool ensure_source_buffer(OverlayState& state) {
  unsigned int width = state.source_width;
  unsigned int height = state.source_height;
  HANDLE share_handle = nullptr;
  DWORD format = 0;
  if (!state.receiver.GetSenderInfo(
          state.options.sender.c_str(), width, height, share_handle, format)) {
    state.consecutive_source_failures += 1;
    if (state.consecutive_source_failures >= state.options.fps * 3 &&
        !state.source_failure_reported) {
      emit_diagnostic("FPNF_SPOUT_SOURCE_UNAVAILABLE");
      state.source_failure_reported = true;
    }
    return false;
  }
  state.consecutive_source_failures = 0;
  state.source_failure_reported = false;
  if (width == 0 || height == 0 || width > 8192 || height > 8192) return false;
  if (width == state.source_width && height == state.source_height &&
      !state.source_pixels.empty()) {
    return true;
  }
  const auto pixel_count = static_cast<std::size_t>(width) * height;
  if (pixel_count > std::numeric_limits<std::size_t>::max() / 4) return false;
  state.source_pixels.assign(pixel_count * 4, 0);
  state.source_width = width;
  state.source_height = height;
  return true;
}

inline std::uint8_t interpolate_channel(
    std::uint8_t p00, std::uint8_t p10, std::uint8_t p01, std::uint8_t p11,
    float x, float y) {
  const float top = p00 + (p10 - p00) * x;
  const float bottom = p01 + (p11 - p01) * x;
  return static_cast<std::uint8_t>(std::clamp(top + (bottom - top) * y, 0.0F, 255.0F));
}

void scale_frame(OverlayState& state, int model_height) {
  const auto target_width = state.target.width;
  const auto target_height = std::clamp(model_height, 1, state.target.height);
  const auto source_width = static_cast<int>(state.source_width);
  const auto source_height = static_cast<int>(state.source_height);
  const float target_aspect = target_width / static_cast<float>(target_height);

  std::fill(
      state.target.pixels,
      state.target.pixels + static_cast<std::size_t>(state.target.width) * state.target.height * 4,
      0);

  float crop_height = source_height / state.options.zoom;
  float crop_width = crop_height * target_aspect;
  if (crop_width > source_width) {
    crop_width = source_width / state.options.zoom;
    crop_height = crop_width / target_aspect;
  }
  const float crop_left = (source_width - crop_width) * 0.5F;
  const float crop_top = source_height - crop_height;

  for (int target_y = 0; target_y < target_height; ++target_y) {
    const float source_y = crop_top +
        ((target_y + 0.5F) / target_height) * crop_height - 0.5F;
    const int y0 = std::clamp(static_cast<int>(std::floor(source_y)), 0, source_height - 1);
    const int y1 = std::min(y0 + 1, source_height - 1);
    const float yf = std::clamp(source_y - y0, 0.0F, 1.0F);

    for (int target_x = 0; target_x < target_width; ++target_x) {
      const float source_x = crop_left +
          ((target_x + 0.5F) / target_width) * crop_width - 0.5F;
      const int x0 = std::clamp(static_cast<int>(std::floor(source_x)), 0, source_width - 1);
      const int x1 = std::min(x0 + 1, source_width - 1);
      const float xf = std::clamp(source_x - x0, 0.0F, 1.0F);

      const auto* p00 = &state.source_pixels[(static_cast<std::size_t>(y0) * source_width + x0) * 4];
      const auto* p10 = &state.source_pixels[(static_cast<std::size_t>(y0) * source_width + x1) * 4];
      const auto* p01 = &state.source_pixels[(static_cast<std::size_t>(y1) * source_width + x0) * 4];
      const auto* p11 = &state.source_pixels[(static_cast<std::size_t>(y1) * source_width + x1) * 4];
      auto* output = &state.target.pixels[(static_cast<std::size_t>(target_y) * target_width + target_x) * 4];

      const auto alpha = interpolate_channel(p00[3], p10[3], p01[3], p11[3], xf, yf);
      output[3] = alpha;
      for (int channel = 0; channel < 3; ++channel) {
        const auto color = interpolate_channel(
            p00[channel], p10[channel], p01[channel], p11[channel], xf, yf);
        output[channel] = static_cast<std::uint8_t>((color * alpha + 127) / 255);
      }
    }
  }
}

bool update_layered_window(HWND window, OverlayState& state, const RECT& bounds) {
  POINT destination{bounds.left, bounds.top};
  SIZE size{state.target.width, state.target.height};
  POINT source{0, 0};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  HDC screen = GetDC(nullptr);
  if (!screen) return false;
  const BOOL updated = UpdateLayeredWindow(
      window, screen, &destination, &size, state.target.dc, &source, 0, &blend, ULW_ALPHA);
  ReleaseDC(nullptr, screen);
  return updated == TRUE;
}

void render_frame(HWND window, OverlayState& state) {
  if (!IsWindow(state.options.owner)) {
    DestroyWindow(window);
    return;
  }
  if (!IsWindowVisible(state.options.owner)) {
    ShowWindow(window, SW_HIDE);
    return;
  }

  RECT bounds{};
  if (!GetWindowRect(state.options.owner, &bounds)) return;
  const int width = bounds.right - bounds.left;
  const int height = bounds.bottom - bounds.top;
  if (width <= 0 || height <= 0) {
    ShowWindow(window, SW_HIDE);
    return;
  }
  if (!ensure_source_buffer(state)) {
    ShowWindow(window, SW_HIDE);
    return;
  }
  if (!state.receiver.ReceiveImage(state.source_pixels.data(), GL_BGRA, false)) {
    state.consecutive_frame_failures += 1;
    if (state.consecutive_frame_failures >= state.options.fps * 3 &&
        !state.frame_failure_reported) {
      emit_diagnostic("FPNF_SPOUT_FRAME_UNAVAILABLE");
      state.frame_failure_reported = true;
    }
    ShowWindow(window, SW_HIDE);
    return;
  }
  state.consecutive_frame_failures = 0;
  state.frame_failure_reported = false;
  if (state.receiver.GetSenderWidth() != state.source_width ||
      state.receiver.GetSenderHeight() != state.source_height) {
    state.source_pixels.clear();
    return;
  }
  if (!state.ready_reported) {
    emit_diagnostic("FPNF_SPOUT_READY");
    state.ready_reported = true;
  }

  const float owner_aspect = width / static_cast<float>(height);
  const bool expanded_chat = owner_aspect > kExpandedChatMinimumAspect;
  const int render_width = expanded_chat ? width / 2 : width;
  RECT overlay_bounds{bounds.left, bounds.top, bounds.left + render_width, bounds.bottom};
  if (!state.target.resize(render_width, height)) return;

  const int widget_safe_area = std::min(kWidgetSafeAreaHeight, height / 3);
  scale_frame(state, height - widget_safe_area);
  SetWindowPos(window, nullptr, overlay_bounds.left, overlay_bounds.top,
               render_width, height,
               SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  update_layered_window(window, state, overlay_bounds);
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  auto* state = reinterpret_cast<OverlayState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  switch (message) {
    case WM_NCCREATE: {
      const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lparam);
      SetWindowLongPtrW(window, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(create->lpCreateParams));
      return TRUE;
    }
    case WM_TIMER:
      if (state && wparam == kFrameTimer) render_frame(window, *state);
      return 0;
    case WM_NCHITTEST:
      return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    case WM_DESTROY:
      KillTimer(window, kFrameTimer);
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(window, message, wparam, lparam);
  }
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
    SetProcessDPIAware();
  }

  int argument_count = 0;
  wchar_t** arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
  if (!arguments) return 2;
  Options options;
  const bool parsed = parse_options(argument_count, arguments, options);
  LocalFree(arguments);
  if (!parsed) return 2;

  OverlayState state;
  state.options = options;
  if (!initialize_spout(state)) return 3;

  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof(window_class);
  window_class.hInstance = instance;
  window_class.lpfnWndProc = window_proc;
  window_class.lpszClassName = kWindowClassName;
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  if (!RegisterClassExW(&window_class) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return 4;

  const HWND window = CreateWindowExW(
      WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
       kWindowClassName, L"FPNF VTube Studio Model", WS_POPUP,
       0, 0, 1, 1, state.options.owner, nullptr, instance, &state);
  if (!window) return 5;

  SetTimer(window, kFrameTimer, std::max<UINT>(16, 1000 / options.fps), nullptr);
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return 0;
}
