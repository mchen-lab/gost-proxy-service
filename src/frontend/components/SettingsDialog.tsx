import { useState, useEffect } from "react";
import { ConfigDialog, ConfigTab } from "./ConfigDialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface AppSettings {
  strategy: string;
  maxRetries: number;
  timeout: number;
}

interface SettingsDialogProps {
  onConfigUpdate?: () => void;
}

export function SettingsDialog({ onConfigUpdate }: SettingsDialogProps) {
  // Data States
  const [settings, setSettings] = useState<AppSettings>({
    strategy: "round",
    maxRetries: 1,
    timeout: 10
  });
  const [proxyText, setProxyText] = useState("");
  const [testUrlsText, setTestUrlsText] = useState("");
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (!hasFetched) {
      fetchData();
      setHasFetched(true);
    }
  }, [hasFetched]);

  const fetchData = async () => {
    try {
      const [settingsRes, proxiesRes, urlsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/proxies"),
        fetch("/api/test-urls")
      ]);

      if (settingsRes.ok) {
        const fullConfig = await settingsRes.json();
        if (fullConfig.system) setSettings(fullConfig.system);
      }

      if (proxiesRes.ok) {
        const data = await proxiesRes.json();
        setProxyText((data.proxies || []).join("\n"));
      }

      if (urlsRes.ok) {
        const data = await urlsRes.json();
        setTestUrlsText((data.urls || []).join("\n"));
      }
    } catch (error) {
      console.error("Failed to load data:", error);
      toast.error("Failed to load configuration");
    }
  };

  const handleSave = async () => {
    // 1. Save Settings (Gost sensitive)
    await fetch("/api/gost-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });

    // 2. Save Proxies
    await fetch("/api/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proxyList: proxyText })
    });

    // 3. Save Test URLs
    const urlsArray = testUrlsText.split("\n").map(s => s.trim()).filter(Boolean);
    await fetch("/api/test-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urlsArray })
    });
  };

  const tabs: ConfigTab[] = [
    {
      id: "general",
      label: "Parameters",
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="strategy" className="text-right">Strategy</Label>
            <Select value={settings.strategy} onValueChange={(val) => setSettings({ ...settings, strategy: val })}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round">Round Robin</SelectItem>
                <SelectItem value="random">Random</SelectItem>
                <SelectItem value="fifo">FIFO</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="timeout" className="text-right">Timeout (s)</Label>
            <Input id="timeout" type="number" min="1" className="col-span-3" value={settings.timeout} onChange={(e) => setSettings({ ...settings, timeout: parseInt(e.target.value) || 1 })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="retries" className="text-right">Max Retries</Label>
            <Input id="retries" type="number" min="0" className="col-span-3" value={settings.maxRetries} onChange={(e) => setSettings({ ...settings, maxRetries: parseInt(e.target.value) || 0 })} />
          </div>
        </div>
      )
    },
    {
      id: "proxies",
      label: "Upstream",
      content: (
        <Textarea
          className="h-full font-mono text-xs resize-none"
          placeholder="host:port (one per line)"
          value={proxyText}
          onChange={(e) => setProxyText(e.target.value)}
        />
      )
    },
    {
      id: "urls",
      label: "Test URLs",
      content: (
        <Textarea
          className="h-full font-mono text-xs resize-none"
          placeholder="http://example.com (one per line)"
          value={testUrlsText}
          onChange={(e) => setTestUrlsText(e.target.value)}
        />
      )
    }
  ];

  return (
    <ConfigDialog
      title="Proxy Configuration"
      tabs={tabs}
      onSave={handleSave}
      onConfigUpdate={onConfigUpdate}
    />
  );
}
