import { createClient } from "@supabase/supabase-js";
// Capture this before the SDK consumes and clears a recovery link's URL fragment.
export const recoveryLink =
  new URLSearchParams(location.hash.slice(1)).get("type") === "recovery";
// A publishable key is intended for browser use. Access is enforced by database/storage RLS.
export const cloudProvider = import.meta.env.VITE_CLOUD_PROVIDER === "cloudbase" ? "cloudbase" : "supabase";
export const cloud = cloudProvider === "cloudbase"
  ? await (async () => {
      const { default: sdk } = await import("@cloudbase/js-sdk");
      const app = sdk.init({
        env: import.meta.env.VITE_CLOUDBASE_ENV_ID,
        region: "ap-shanghai",
        ...(import.meta.env.VITE_CLOUDBASE_PUBLIC_KEY ? { accessKey: import.meta.env.VITE_CLOUDBASE_PUBLIC_KEY } : {}),
        persistence: "local",
      });
      return { auth: app.auth, storage: app.storage, from: (table) => app.rdb().from(table) };
    })()
  : createClient(
  "https://xcndecoavcnohnmwsbhx.supabase.co",
  "sb_publishable_EOgnrjY7k2WaIHXGKTvz5Q_gHlh5GXk",
);
