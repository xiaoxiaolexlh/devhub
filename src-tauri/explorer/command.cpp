#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <shlguid.h>
#include <wrl.h>
#include <filesystem>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;

// Must match AppxManifest.xml.in. Loaded by Windows' COM surrogate, not DevHub.
static const CLSID CLSID_DevHub =
    {0xb38ae321, 0xc422, 0x467a, {0xa6, 0x82, 0x49, 0x79, 0xa6, 0x71, 0x31, 0x28}};
static HMODULE moduleHandle;
static LONG objectCount;
static LONG serverLocks;

static std::wstring executablePath() {
    std::vector<wchar_t> path(32768);
    DWORD size = GetModuleFileNameW(moduleHandle, path.data(), static_cast<DWORD>(path.size()));
    if (!size || size == path.size()) return {};
    // <app>/resources/explorer/devhub-explorer.dll
    return (std::filesystem::path(path.data()).parent_path().parent_path().parent_path()
        / L"devhub.exe").wstring();
}

// Windows argv quoting, including drive roots and paths ending in backslashes.
static std::wstring quoteArgument(const std::wstring& value) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t ch : value) {
        if (ch == L'\\') { ++slashes; continue; }
        result.append(ch == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        result += ch;
        slashes = 0;
    }
    result.append(slashes * 2, L'\\');
    return result + L'"';
}

static HRESULT fileSystemPath(IShellItem* item, std::wstring& path) {
    PWSTR raw = nullptr;
    HRESULT hr = item->GetDisplayName(SIGDN_FILESYSPATH, &raw);
    if (SUCCEEDED(hr)) path = raw;
    CoTaskMemFree(raw);
    return hr;
}

class DevHubCommand final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IExplorerCommand, IObjectWithSite> {
    ComPtr<IUnknown> site;

    HRESULT backgroundItem(IShellItem** item) {
        if (!site) return E_FAIL;
        ComPtr<IServiceProvider> services;
        HRESULT hr = site.As(&services);
        if (FAILED(hr)) return hr;
        ComPtr<IFolderView> view;
        hr = services->QueryService(SID_SFolderView, IID_PPV_ARGS(&view));
        if (FAILED(hr)) return hr;
        ComPtr<IPersistFolder2> folder;
        hr = view->GetFolder(IID_PPV_ARGS(&folder));
        if (FAILED(hr)) return hr;
        PIDLIST_ABSOLUTE id = nullptr;
        hr = folder->GetCurFolder(&id);
        if (SUCCEEDED(hr)) hr = SHCreateItemFromIDList(id, IID_PPV_ARGS(item));
        CoTaskMemFree(id);
        return hr;
    }

public:
    DevHubCommand() { InterlockedIncrement(&objectCount); }
    ~DevHubCommand() { InterlockedDecrement(&objectCount); }

    IFACEMETHODIMP GetTitle(IShellItemArray*, PWSTR* result) override {
        return SHStrDupW(L"通过 DevHub 打开", result);
    }
    IFACEMETHODIMP GetIcon(IShellItemArray*, PWSTR* result) override {
        return SHStrDupW((executablePath() + L",0").c_str(), result);
    }
    IFACEMETHODIMP GetToolTip(IShellItemArray*, PWSTR* result) override {
        return SHStrDupW(L"使用 DevHub 设置的默认方式打开", result);
    }
    IFACEMETHODIMP GetCanonicalName(GUID* result) override {
        *result = CLSID_DevHub;
        return S_OK;
    }
    IFACEMETHODIMP GetState(IShellItemArray* items, BOOL, EXPCMDSTATE* state) override {
        // Only advertise one filesystem item. Never perform disk/network IO while
        // Explorer is calculating the menu on its UI thread.
        *state = ECS_HIDDEN;
        ComPtr<IShellItem> item;
        DWORD count = 0;
        if (items && SUCCEEDED(items->GetCount(&count)) && count > 0) {
            if (count != 1) return S_OK;
            if (FAILED(items->GetItemAt(0, &item))) return S_OK;
        } else if (FAILED(backgroundItem(&item))) {
            return S_OK;
        }
        SFGAOF attributes = 0;
        if (SUCCEEDED(item->GetAttributes(SFGAO_FILESYSTEM, &attributes)) &&
            (attributes & SFGAO_FILESYSTEM)) *state = ECS_ENABLED;
        return S_OK;
    }
    IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx*) override {
        ComPtr<IShellItem> item;
        DWORD count = 0;
        HRESULT hr;
        if (items && SUCCEEDED(items->GetCount(&count)) && count > 0) {
            if (count != 1) return E_INVALIDARG;
            hr = items->GetItemAt(0, &item);
        } else {
            hr = backgroundItem(&item);
        }
        if (FAILED(hr)) return hr;
        std::wstring path;
        hr = fileSystemPath(item.Get(), path);
        if (FAILED(hr)) return hr;
        const auto exe = executablePath();
        if (exe.empty()) return E_FAIL;
        std::wstring command = quoteArgument(exe) + L" --open-with-default " + quoteArgument(path);
        STARTUPINFOW startup = {sizeof(startup)};
        PROCESS_INFORMATION process = {};
        // No shell, PowerShell or cmd interpolation: filenames are argv data.
        if (!CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, FALSE,
                CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) {
            return HRESULT_FROM_WIN32(GetLastError());
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        return S_OK;
    }
    IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) override { *flags = ECF_DEFAULT; return S_OK; }
    IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** commands) override {
        *commands = nullptr;
        return E_NOTIMPL;
    }
    IFACEMETHODIMP SetSite(IUnknown* newSite) override { site = newSite; return S_OK; }
    IFACEMETHODIMP GetSite(REFIID iid, void** result) override {
        *result = nullptr;
        return site ? site->QueryInterface(iid, result) : E_NOINTERFACE;
    }
};

class Factory final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IClassFactory> {
public:
    Factory() { InterlockedIncrement(&objectCount); }
    ~Factory() { InterlockedDecrement(&objectCount); }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** result) override {
        *result = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        auto command = Microsoft::WRL::Make<DevHubCommand>();
        return command ? command->QueryInterface(iid, result) : E_OUTOFMEMORY;
    }
    IFACEMETHODIMP LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&serverLocks);
        else InterlockedDecrement(&serverLocks);
        return S_OK;
    }
};

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID iid, void** result) {
    *result = nullptr;
    if (clsid != CLSID_DevHub) return CLASS_E_CLASSNOTAVAILABLE;
    auto factory = Microsoft::WRL::Make<Factory>();
    return factory ? factory->QueryInterface(iid, result) : E_OUTOFMEMORY;
}
extern "C" HRESULT __stdcall DllCanUnloadNow() {
    return objectCount == 0 && serverLocks == 0 ? S_OK : S_FALSE;
}
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) moduleHandle = instance;
    return TRUE;
}
