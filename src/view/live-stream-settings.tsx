import { useMemo, useState } from "react";
import {
  Play,
  Square,
  Copy,
  Check,
  AlertCircle,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfigStore } from "@/store/config";
import type { Area, Stream } from "@/types/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { LoadingButton } from "@/components/loading-button";
import {
  getLiveVersion,
  startLive,
  stopLive,
  updateRoomArea,
  updateRoomTitle,
} from "@/api/live";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { Separator } from "@/components/ui/separator";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function containsAuthHint(text: string): boolean {
  return ["身份验证", "人脸认证", "认证", "验证", "唤起"].some((keyword) =>
    text.includes(keyword),
  );
}

function buildFaceAuthFallbackQr(): string | null {
  const state = useConfigStore.getState();
  const dedeUserId = state.getCookie("DedeUserID");
  const uidFromConfig = state.config.uid > 0 ? String(state.config.uid) : null;
  const mid = dedeUserId || uidFromConfig;
  if (!mid) return null;
  const params = new URLSearchParams({
    source_event: "400",
    mid: mid,
  });
  return `https://www.bilibili.com/blackboard/live/face-auth-middle.html?${params.toString()}`;
}

function normalizeQrPayload(value: string): string {
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (value.startsWith("/")) {
    return `https://link.bilibili.com${value}`;
  }
  return value;
}

function looksLikeUrlOrDeepLink(value: string): boolean {
  if (isHttpUrl(value)) return true;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) return true;
  if (value.startsWith("//") || value.startsWith("/")) return true;
  return false;
}

function isHttpBiliUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.hostname.includes("bilibili.com") || url.hostname.includes("hdslb.com")
    );
  } catch {
    return false;
  }
}

function hasAuthKeyword(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("qr") ||
    lower.includes("verify") ||
    lower.includes("auth") ||
    lower.includes("identity") ||
    lower.includes("cert") ||
    value.includes("人脸") ||
    value.includes("认证") ||
    value.includes("验证")
  );
}

function isStreamProtocol(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("rtmp://") ||
    lower.startsWith("srt://") ||
    lower.startsWith("ws://") ||
    lower.startsWith("wss://")
  );
}

function isAuthQrCandidate(key: string, value: string): boolean {
  const lowerKey = key.toLowerCase();
  const normalized = normalizeQrPayload(value.trim());
  if (!normalized) return false;
  if (isStreamProtocol(normalized)) return false;

  const isQrLikeField =
    lowerKey.includes("qr") ||
    lowerKey.includes("qrcode") ||
    lowerKey.includes("verify") ||
    lowerKey.includes("auth") ||
    lowerKey.includes("face") ||
    lowerKey.includes("identity") ||
    lowerKey.includes("cert") ||
    lowerKey.includes("url") ||
    lowerKey.includes("link") ||
    lowerKey.includes("jump") ||
    lowerKey.includes("redirect");

  if (!looksLikeUrlOrDeepLink(normalized)) return false;

  if (isHttpUrl(normalized)) {
    if (!isHttpBiliUrl(normalized)) return false;
    return isQrLikeField || hasAuthKeyword(normalized);
  }

  const lowerValue = normalized.toLowerCase();
  const isBiliDeepLink =
    lowerValue.startsWith("bilibili://") || lowerValue.startsWith("bili://");
  if (isBiliDeepLink) {
    return isQrLikeField || hasAuthKeyword(normalized);
  }

  // 只允许 bilibili 相关相对链接。
  if (normalized.startsWith("/") || normalized.startsWith("//")) {
    return isQrLikeField || hasAuthKeyword(normalized);
  }

  return false;
}

function extractUrlFromText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"']+/i);
  return match ? match[0] : null;
}

function extractAuthQrPayload(payload: unknown): string | null {
  const candidates: { score: number; value: string }[] = [];
  const queue: unknown[] = [payload];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;

    if (typeof current === "string") {
      const normalized = normalizeQrPayload(current.trim());
      if (isAuthQrCandidate("raw", normalized)) {
        candidates.push({ score: 10, value: normalized });
      }
      const urlInText = extractUrlFromText(current);
      if (urlInText && isAuthQrCandidate("message_url", urlInText)) {
        candidates.push({ score: 60, value: normalizeQrPayload(urlInText) });
      }
      continue;
    }

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) {
          continue;
        }
        const normalized = normalizeQrPayload(raw);
        if (isAuthQrCandidate(key, normalized)) {
          const lowerKey = key.toLowerCase();
          let score = 40;
          if (lowerKey.includes("qr") || lowerKey.includes("qrcode")) score = 100;
          else if (
            lowerKey.includes("verify") ||
            lowerKey.includes("auth") ||
            lowerKey.includes("face")
          )
            score = 90;
          else if (
            lowerKey.includes("identity") ||
            lowerKey.includes("cert") ||
            lowerKey.includes("scan")
          )
            score = 80;
          candidates.push({ score, value: normalized });
        }
        const urlInText = extractUrlFromText(raw);
        if (urlInText && isAuthQrCandidate(`${key}_text`, urlInText)) {
          candidates.push({ score: 50, value: normalizeQrPayload(urlInText) });
        }
      }

      if (isRecord(value) || Array.isArray(value)) {
        if (!visited.has(value)) {
          visited.add(value);
          queue.push(value);
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].value;
}

export function LiveStreamSettings() {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [isQrDialogOpen, setIsQrDialogOpen] = useState<boolean>(false);

  const updateConfig = useConfigStore((s) => s.updateConfig);
  const areaList = useConfigStore((s) => s.config.areaList);
  const { roomTitle, categoryId, areaId, isOpenLive, streams } = useConfigStore(
    (s) => s.config,
  );

  const selectedParent = useMemo(
    () => areaList.find((p) => p.id === categoryId),
    [areaList, categoryId],
  );
  const childAreas: Area[] = useMemo(
    () => selectedParent?.list ?? [],
    [selectedParent],
  );
  const isTitleValid = useMemo(() => {
    return roomTitle.trim() !== "";
  }, [roomTitle]);
  const isCategoryValid = useMemo(() => {
    return categoryId !== "";
  }, [categoryId]);
  const isAreaValid = useMemo(() => {
    return areaId !== "";
  }, [areaId]);

  const canStartStream = useMemo(() => {
    return !isOpenLive && isTitleValid && isCategoryValid && isAreaValid;
  }, [isOpenLive, isTitleValid, isCategoryValid, isAreaValid]);

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const setIsStreaming = (status: boolean) => {
    useConfigStore.getState().updateConfig({ isOpenLive: status });
  };

  const handleStartStream = async () => {
    if (!canStartStream) return;
    try {
      const version = await getLiveVersion();
      const currentVer = version.curr_version;
      const currentBuild = String(version.build);

      // set title
      await handleUpdateTitle();

      // 开始直播请求
      const startRes = await startLive(currentVer, currentBuild);
      if (startRes.code === 0) {
        // 成功
        let rtmp = 1;
        let srt = 0;
        const result: Stream[] = [];
        result.push({
          type: "rtmp-1",
          address: startRes.data.rtmp.addr,
          key: startRes.data.rtmp.code,
        });
        startRes.data.protocols.forEach((v) => {
          if (v.protocol === "rtmp" && v.addr && v.code) {
            rtmp++;
            result.push({
              type: `rtmp-${rtmp}`,
              address: v.addr,
              key: v.code,
            });
          }
          if (v.protocol === "srt" && v.addr && v.code) {
            srt++;
            result.push({
              type: `srt-${srt}`,
              address: v.addr,
              key: v.code,
            });
          }
        });
        result.sort((a, b) => a.type.localeCompare(b.type));
        updateConfig({ streams: result });
        setIsStreaming(true);
        return;
      }

      const authQrPayload =
        extractAuthQrPayload(startRes.data) || extractAuthQrPayload(startRes);
      if (authQrPayload) {
        setQrCodeUrl(authQrPayload);
        setIsQrDialogOpen(true);
        setIsStreaming(false);
        toast.info("已弹出身份认证二维码，请使用哔哩哔哩 App 扫码完成验证。");
        return;
      }

      if (containsAuthHint(startRes.message)) {
        const fallbackQr = buildFaceAuthFallbackQr();
        if (fallbackQr) {
          setQrCodeUrl(fallbackQr);
          setIsQrDialogOpen(true);
          setIsStreaming(false);
          toast.info("接口未返回二维码，已切换为人脸认证入口二维码。");
          return;
        }
        throw new Error("需要身份验证，但无法生成人脸认证入口（缺少账号 mid）。");
      }

      if (startRes.code === 60024) {
        throw new Error("需要身份验证，但没有拿到二维码，请重试。");
      }
      throw new Error("开始直播失败：" + startRes.message);
    } catch (error) {
      console.error("Start Live:", error);
      toast.error((error as Error).message);
    }
  };

  const handleEndStream = async () => {
    setIsStreaming(false);
    await stopLive();
  };

  const handleFaceAuth = async () => {
    try {
      const version = await getLiveVersion();
      const currentVer = version.curr_version;
      const currentBuild = String(version.build);
      const startRes = await startLive(currentVer, currentBuild);

      if (startRes.code === 0) {
        await stopLive();
        toast.success("当前账号无需额外身份验证，可直接开始直播。");
        return;
      }

      const authQrPayload =
        extractAuthQrPayload(startRes.data) || extractAuthQrPayload(startRes);
      if (authQrPayload) {
        setQrCodeUrl(authQrPayload);
        setIsQrDialogOpen(true);
        toast.info("已弹出人脸认证二维码，请使用哔哩哔哩 App 完成验证。");
        return;
      }

      if (containsAuthHint(startRes.message)) {
        const fallbackQr = buildFaceAuthFallbackQr();
        if (fallbackQr) {
          setQrCodeUrl(fallbackQr);
          setIsQrDialogOpen(true);
          toast.info("接口未返回二维码，已切换为人脸认证入口二维码。");
          return;
        }
        throw new Error("需要身份验证，但无法生成人脸认证入口（缺少账号 mid）。");
      }

      if (startRes.code === 60024) {
        throw new Error("需要身份验证，但没有拿到二维码。");
      }

      throw new Error(`人脸认证二维码获取失败：${startRes.message}`);
    } catch (error) {
      console.error("Face Auth:", error);
      toast.error((error as Error).message);
    }
  };

  const handleUpdateTitle = async () => {
    // 设置直播间标题
    try {
      await updateRoomTitle(roomTitle);
      toast.success("直播间标题更新成功");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleUpdateArea = async () => {
    // 设置直播间分区
    try {
      await updateRoomArea(areaId);
      toast.success("直播间分区更新成功");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="space-y-2">
              <Label htmlFor="stream-title">直播间标题</Label>
              <div className="flex gap-2">
                <Input
                  id="stream-title"
                  value={roomTitle}
                  onChange={(e) => updateConfig({ roomTitle: e.target.value })}
                  placeholder="请输入您的直播标题……"
                  className="flex-1"
                />
                <LoadingButton
                  variant="outline"
                  onClickAsync={handleUpdateTitle}
                  disabled={!isTitleValid}>
                  更新标题
                </LoadingButton>
              </div>
            </div>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>分区设置</Label>
              <LoadingButton
                variant="outline"
                size="sm"
                disabled={!isAreaValid}
                onClickAsync={handleUpdateArea}>
                更新分区
              </LoadingButton>
            </div>
            <div className="flex gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="category"
                  className="text-xs text-muted-foreground">
                  分类
                </Label>
                <Select
                  value={categoryId}
                  onValueChange={(value) => {
                    updateConfig({
                      categoryId: value,
                      areaId: "",
                    });
                  }}>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {areaList.map((parent) => (
                        <SelectItem key={parent.id} value={parent.id}>
                          {parent.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="area" className="text-xs text-muted-foreground">
                  子分区
                </Label>
                <Select
                  value={areaId}
                  onValueChange={(value) => {
                    updateConfig({
                      areaId: value,
                    });
                  }}
                  disabled={!isCategoryValid}>
                  <SelectTrigger id="area">
                    <SelectValue placeholder="选择分区" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {childAreas.map((area) => (
                        <SelectItem key={area.id} value={area.id}>
                          <img
                            src={area.pic}
                            alt={area.name}
                            className="h-5 w-5 rounded-sm object-cover"
                          />
                          {area.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex gap-3">
            <LoadingButton
              onClickAsync={handleStartStream}
              disabled={!canStartStream}
              className="flex-1">
              <HugeiconsIcon icon={Play} className="mr-1" />
              开始直播
            </LoadingButton>
            <LoadingButton
              variant="destructive"
              onClickAsync={handleEndStream}
              disabled={!isOpenLive}
              className="flex-1">
              <HugeiconsIcon icon={Square} className="mr-1" />
              停止直播
            </LoadingButton>
          </div>
          <LoadingButton
            variant="outline"
            onClickAsync={handleFaceAuth}
            disabled={isOpenLive}>
            <HugeiconsIcon icon={AlertCircle} className="mr-1" />
            人脸认证
          </LoadingButton>
        </CardContent>
      </Card>
      <Dialog modal open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>验证</DialogTitle>
            <DialogDescription>
              本次开播需要身份验证，请使用哔哩哔哩 App
              扫码完成验证。扫码完成后，请手动关闭此对话框。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid flex-1 gap-2">
              <div className="mx-auto rounded-2xl border border-pink-300/90 bg-pink-50/70 p-3 shadow-sm dark:border-pink-400/40 dark:bg-pink-500/10">
                <div className="rounded-xl bg-background p-2">
                  <QRCodeSVG value={qrCodeUrl} size={240} />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="space-y-2">
        {isOpenLive && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-xs text-foreground">直播中</span>
          </div>
        )}
      </div>
      {isOpenLive && (
        <Card>
          <CardContent className="space-y-3">
            <div className="text-sm">流媒体凭证</div>
            <Tabs defaultValue="rtmp-1" className="w-full">
              <TabsList className="mb-4 w-full">
                {streams.map((stream) => (
                  <TabsTrigger key={stream.type} value={stream.type}>
                    {stream.type.toUpperCase()}
                  </TabsTrigger>
                ))}
              </TabsList>
              {streams.map((stream) => (
                <TabsContent
                  key={stream.type}
                  value={stream.type}
                  className="mt-0 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      服务器地址
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={stream.address}
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleCopy(stream.address, stream.type)}>
                        {copiedField === stream.type ? (
                          <HugeiconsIcon
                            icon={Check}
                            className="h-4 w-4 text-primary"
                          />
                        ) : (
                          <HugeiconsIcon icon={Copy} className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      流密钥
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={stream.key}
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() =>
                          handleCopy(stream.key, `${stream.type}-key`)
                        }>
                        {copiedField === `${stream.type}-key` ? (
                          <HugeiconsIcon
                            icon={Check}
                            className="h-4 w-4 text-primary"
                          />
                        ) : (
                          <HugeiconsIcon icon={Copy} className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
