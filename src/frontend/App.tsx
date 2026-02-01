import { useState, useEffect, useCallback, useRef } from "react";
import { useAppKit } from "@mchen-lab/app-kit/frontend";
import { AboutDialog } from "@mchen-lab/app-kit/components";
import logoImage from "./logo.png";
import { SystemStatus } from "./components/SystemStatus";
import { LogViewer } from "./components/LogViewer";
import { Layout } from "./components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Play, Square, Activity, Loader2 } from "lucide-react";

interface Status {
  online: boolean;
  proxyServiceReady: boolean;
  proxyCount: number;
  gost?: {
    running: boolean;
    pid: number | null;
  };
}

interface TestResult {
  site: string;
  success: boolean;
  ip?: string;
  time: number;
  error?: string;
}

function App() {
  const { settings: globalSettings, refreshSettings } = useAppKit();
  const [status, setStatus] = useState<Status>({
    online: false,
    proxyServiceReady: false,
    proxyCount: 0,
  });

  // Test Runner State
  const [testUrls, setTestUrls] = useState<string[]>([]);
  const [testStats, setTestStats] = useState({ total: 0, success: 0, fail: 0 });
  const [isTesting, setIsTesting] = useState(false);
  const [showNoProxiesAlert, setShowNoProxiesAlert] = useState(false);
  const abortRef = useRef(false);
  const isTestingRef = useRef(false);
  const testTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TEST_DURATION_LIMIT = 2 * 60 * 1000;

  const fetchURLs = useCallback(async () => {
    try {
      const res = await fetch("/api/test-urls");
      if (res.ok) {
        const data = await res.json();
        setTestUrls(data.urls || []);
      }
    } catch {
      console.warn("Failed to fetch test URLs");
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/gost-status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus(prev => ({ ...prev, online: false }));
      }
    } catch {
      setStatus({ online: false, proxyServiceReady: false, proxyCount: 0 });
    }
  }, []);

  useEffect(() => {
    fetchURLs();
  }, [fetchURLs]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const stopTest = useCallback(async () => {
    if (abortRef.current) return;
    abortRef.current = true;
    isTestingRef.current = false;
    setIsTesting(false);
    if (testTimeoutRef.current) {
      clearTimeout(testTimeoutRef.current);
      testTimeoutRef.current = null;
    }
    fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "🛑 Testing stopped", level: "INFO" })
    }).catch(() => {});
  }, []);

  const handleServiceAction = async (action: "start" | "stop" | "restart") => {
    if (isTesting && (action === "stop" || action === "restart")) {
      stopTest();
    }

    if (action === "restart") {
      setTestStats({ total: 0, success: 0, fail: 0 });
    }

    const actionMap = { start: "Starting", stop: "Stopping", restart: "Restarting" };
    const successMap = { start: "Started", stop: "Stopped", restart: "Restarted" };

    const promise = async () => {
      const res = await fetch(`/api/service/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      await fetchStatus();
    };

    toast.promise(promise(), {
      loading: `${actionMap[action]} proxy service...`,
      success: `${successMap[action]} service successfully`,
      error: `Failed to ${action} service`,
    });
  };

  const startTest = useCallback(async () => {
    if (isTestingRef.current) return;
    isTestingRef.current = true;

    if (status.proxyCount === 0) {
      isTestingRef.current = false;
      setShowNoProxiesAlert(true);
      return;
    }

    try {
      const res = await fetch("/api/test-urls");
      const data = await res.json();
      const urls = data.urls || [];
      if (urls.length === 0) {
        isTestingRef.current = false;
        toast.error("No test URLs configured");
        return;
      }

      setIsTesting(true);
      abortRef.current = false;
      setTestStats({ total: 0, success: 0, fail: 0 });

      fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `🚀 Testing started (${urls.length} URLs)`, level: "INFO" })
      }).catch(() => {});

      if (testTimeoutRef.current) clearTimeout(testTimeoutRef.current);
      testTimeoutRef.current = setTimeout(() => {
        if (!abortRef.current) {
          abortRef.current = true;
          setIsTesting(false);
          toast.info("Testing stopped after 2 minutes");
        }
      }, TEST_DURATION_LIMIT);

      let siteIndex = 0;
      const runNext = async () => {
        if (abortRef.current) return;
        const url = urls[siteIndex % urls.length];
        const name = new URL(url).hostname;
        siteIndex++;
        const start = Date.now();
        try {
          const response = await fetch(`/api/test?url=${encodeURIComponent(url)}`);
          const data = await response.json();
          const elapsed = Date.now() - start;
          const result: TestResult = {
            site: name,
            time: elapsed, success: response.ok && data.success,
            ip: data.ip || data.result, error: data.error
          };
          setTestStats(prev => ({
            total: prev.total + 1,
            success: prev.success + (result.success ? 1 : 0),
            fail: prev.fail + (result.success ? 0 : 1)
          }));

          // Broadcast result to logs
          fetch("/api/logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `${result.success ? '✅' : '❌'} ${result.site}: ${result.success ? (result.ip || 'OK') : (result.error || 'Failed')} (${result.time}ms)`,
              level: "GOST",
              success: result.success
            })
          }).catch(() => {});
        } catch { }
        if (!abortRef.current) setTimeout(runNext, 500);
      };
      runNext();
    } catch {
      isTestingRef.current = false;
      toast.error("Failed to start tests");
      setIsTesting(false);
    }
  }, [status.proxyCount, TEST_DURATION_LIMIT]);

  // Status badges for the header
  const statusBadges = (
    <Badge variant="outline" className={`gap-1.5 ${status.online ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
      <span className={`h-2 w-2 rounded-full ${status.online ? "bg-emerald-500" : "bg-red-500"}`} />
      {status.online ? "Running" : "Stopped"}
    </Badge>
  );

  // Action buttons for the secondary bar
  const secondaryBar = (
    <>
      <Button
        size="sm"
        className={`h-9 px-3 gap-2 transition-all cursor-pointer ${
          status.gost?.running
            ? "bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-100"
            : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md hover:shadow-lg border-emerald-700"
        }`}
        onClick={() => handleServiceAction("start")}
        disabled={!!status.gost?.running}
      >
        <Play className="h-3.5 w-3.5 fill-current" /> Start
      </Button>
      <Button
        size="sm"
        className="h-9 px-3 gap-2 transition-all cursor-pointer bg-red-600 text-white hover:bg-red-700 shadow-md hover:shadow-lg border-red-700 disabled:opacity-50 disabled:shadow-none"
        onClick={() => handleServiceAction("stop")}
        disabled={!status.gost?.running}
      >
        <Square className="h-3.5 w-3.5 fill-current" /> Stop
      </Button>
      <Button
        size="sm"
        className={`h-9 px-3 gap-2 transition-all cursor-pointer ${
          isTesting
            ? "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
            : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
        }`}
        onClick={isTesting ? stopTest : startTest}
        disabled={!status.gost?.running}
      >
        {isTesting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Activity className="h-3.5 w-3.5" />
        )}
        {isTesting ? "Testing..." : "Test"}
      </Button>
    </>
  );

  return (
    <>
      <Layout
        title="Proxy Service"
        logo={logoImage}
        statusBadges={statusBadges}
        secondaryBar={secondaryBar}
      >
        <div className="flex flex-col gap-4 h-[calc(100vh-160px)]">
          <SystemStatus
            settings={globalSettings?.system || { strategy: 'round', timeout: 10, maxRetries: 1 }}
            proxyCount={status.proxyCount}
            testUrlCount={testUrls.length}
            testerStats={testStats}
            pid={status.gost?.pid || null}
            port={31131}
          />

          <section className="flex-1 min-h-0">
            <LogViewer />
          </section>
        </div>
      </Layout>

      <AlertDialog open={showNoProxiesAlert} onOpenChange={setShowNoProxiesAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No Upstream Proxies Configured</AlertDialogTitle>
            <AlertDialogDescription>
              You need to configure at least one upstream proxy before running tests.
              Click the Settings icon in the header to add your proxy servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster />
    </>
  );
}

export default App;
