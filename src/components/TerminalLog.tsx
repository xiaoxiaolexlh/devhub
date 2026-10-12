import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalLogProps {
  stderr?: string;
  stdout?: string;
}

export function TerminalLog({ stdout = "", stderr = "" }: TerminalLogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 8000,
      theme: {
        background: "#020617",
        foreground: "#E5E7EB",
        cursor: "#A5B4FC",
        selectionBackground: "#334155",
        black: "#0F172A",
        red: "#F87171",
        green: "#34D399",
        yellow: "#FBBF24",
        blue: "#60A5FA",
        magenta: "#C084FC",
        cyan: "#22D3EE",
        white: "#E5E7EB",
        brightBlack: "#475569",
        brightRed: "#FCA5A5",
        brightGreen: "#6EE7B7",
        brightYellow: "#FDE68A",
        brightBlue: "#93C5FD",
        brightMagenta: "#D8B4FE",
        brightCyan: "#67E8F9",
        brightWhite: "#F8FAFC",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const fitSoon = () => {
      requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // Container may be hidden during initial layout.
        }
      });
    };
    fitSoon();
    const observer = new ResizeObserver(fitSoon);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    if (stdout) terminal.write(normalizeForTerminal(stdout));
    if (stderr) {
      terminal.write("\r\n\u001b[31m");
      terminal.write(normalizeForTerminal(stderr));
      terminal.write("\u001b[0m");
    }
    terminal.scrollToBottom();
  }, [stdout, stderr]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[#020617]">
      <div ref={containerRef} className="h-64 w-full p-2" />
    </div>
  );
}

function normalizeForTerminal(value: string) {
  return value.replace(/(^|[^\r])\n/g, "$1\r\n");
}
