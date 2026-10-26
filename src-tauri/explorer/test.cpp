// No registration and no DevHub launch: test the shell contract in-process.
#include "command.cpp"
#include <shellapi.h>
#include <cassert>
#include <iostream>

int wmain(int argc, wchar_t** argv) {
    assert(argc == 2);
    assert(SUCCEEDED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)));
    const std::vector<std::wstring> paths = {
        L"D:\\", L"D:\\项目 文件夹\\配置.json", L"D:\\a&b%PATH%$(test)'\\",
        L"\\\\server\\shared folder\\", L"D:\\a#b\\x.txt", L"embedded\"quote", L"",
    };
    for (const auto& path : paths) {
        int count = 0;
        const auto command = quoteArgument(L"D:\\程序 目录\\devhub.exe")
            + L" --open-with-default " + quoteArgument(path);
        auto parsed = CommandLineToArgvW(command.c_str(), &count);
        assert(parsed && count == 3 && std::wstring(parsed[1]) == L"--open-with-default" && path == parsed[2]);
        LocalFree(parsed);
    }
    assert(DllCanUnloadNow() == S_OK);
    {
        ComPtr<IClassFactory> factory;
        assert(SUCCEEDED(DllGetClassObject(CLSID_DevHub, IID_PPV_ARGS(&factory))));
        assert(DllCanUnloadNow() == S_FALSE);
        ComPtr<IExplorerCommand> command;
        assert(SUCCEEDED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&command))));
        PWSTR title = nullptr;
        assert(SUCCEEDED(command->GetTitle(nullptr, &title)));
        assert(std::wstring(title) == L"通过 DevHub 打开");
        CoTaskMemFree(title);
        GUID canonical;
        assert(SUCCEEDED(command->GetCanonicalName(&canonical)) && canonical == CLSID_DevHub);
        EXPCMDSTATE state;
        assert(SUCCEEDED(command->GetState(nullptr, FALSE, &state)) && state == ECS_HIDDEN);
        const std::filesystem::path project(argv[1]);
        for (const auto& path : {project, project / L"package.json"}) {
            ComPtr<IShellItem> item;
            assert(SUCCEEDED(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(&item))));
            ComPtr<IShellItemArray> selection;
            assert(SUCCEEDED(SHCreateShellItemArrayFromShellItem(item.Get(), IID_PPV_ARGS(&selection))));
            assert(SUCCEEDED(command->GetState(selection.Get(), FALSE, &state)) && state == ECS_ENABLED);
        }
        assert(FAILED(command->Invoke(nullptr, nullptr))); // No selection/site never launches anything.
        assert(SUCCEEDED(factory->LockServer(TRUE)));
        assert(SUCCEEDED(factory->LockServer(FALSE)));
    }
    assert(DllCanUnloadNow() == S_OK);
    CoUninitialize();
    std::cout << "Explorer contract passed: 7 argv cases, file/folder visibility, title, COM lifetime.\n";
}
