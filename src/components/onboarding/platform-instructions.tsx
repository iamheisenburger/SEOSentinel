"use client";

import {
  GitBranch,
  Globe,
  Webhook,
  Copy,
  ShoppingBag,
  Layout,
  Palette,
  FileCode,
} from "lucide-react";

const platforms = [
  {
    id: "github",
    name: "GitHub (Next.js, Astro, Hugo, Jekyll)",
    icon: GitBranch,
    color: "#EDEEF1",
    steps: [
      "Articles are committed as MDX files to your GitHub repository",
      "Set your repo owner and name in the onboarding wizard",
      "Files land in content/posts/[slug].mdx with full frontmatter",
      "Your static site generator picks them up on the next build",
      "Works with Next.js, Astro, Hugo, Jekyll, Gatsby, and any SSG",
    ],
  },
  {
    id: "wordpress",
    name: "WordPress",
    icon: Globe,
    color: "#0EA5E9",
    steps: [
      "Go to Users → Profile → Application Passwords in your WP admin",
      "Create a new Application Password (give it a name like \"Pentra\")",
      "Copy the generated password — this is NOT your login password",
      "Enter your site URL, username, and the app password in the wizard",
      "Articles are published directly via the WordPress REST API",
    ],
  },
  {
    id: "webhook",
    name: "Webhook (Custom Integration)",
    icon: Webhook,
    color: "#22C55E",
    steps: [
      "Set up an endpoint on your server that accepts POST requests",
      "Enter the URL in the wizard — optionally add a secret for HMAC verification",
      "Each article sends: { title, slug, markdown, html, metaDescription, sources }",
      "If a secret is set, we include an X-Signature-256 header for verification",
      "Use this for any custom CMS, headless setup, or automation pipeline",
    ],
  },
  {
    id: "wix",
    name: "Wix",
    icon: Layout,
    color: "#F59E0B",
    steps: [
      "Select \"Copy & Paste\" as your publish method during onboarding",
      "Go to your Wix dashboard → Blog → Create New Post",
      "Click \"Copy HTML\" on your article in Pentra",
      "Paste into the Wix editor (use the HTML embed block for best results)",
      "Add your title, featured image, and publish",
    ],
  },
  {
    id: "squarespace",
    name: "Squarespace",
    icon: Palette,
    color: "#EDEEF1",
    steps: [
      "Select \"Copy & Paste\" as your publish method during onboarding",
      "Go to your Squarespace dashboard → Pages → Blog",
      "Click \"+\" to create a new blog post",
      "Click \"Copy Markdown\" on your article and paste into the editor",
      "Squarespace supports markdown formatting natively",
    ],
  },
  {
    id: "shopify",
    name: "Shopify",
    icon: ShoppingBag,
    color: "#22C55E",
    steps: [
      "Select \"Copy & Paste\" as your publish method during onboarding",
      "Go to Shopify admin → Online Store → Blog Posts → Add blog post",
      "Click \"Copy HTML\" on your article in Pentra",
      "Switch the Shopify editor to HTML mode (\"<>\" button)",
      "Paste the HTML content, add your title, and publish",
    ],
  },
  {
    id: "webflow",
    name: "Webflow",
    icon: FileCode,
    color: "#0EA5E9",
    steps: [
      "Select \"Copy & Paste\" or use the Webhook method for automation",
      "For manual: Copy HTML from the article detail page",
      "In Webflow CMS, create a new blog post and paste into the rich text field",
      "For automation: use Webflow's CMS API with our webhook adapter",
      "Set the webhook URL to your Webflow CMS API endpoint",
    ],
  },
];

export function PlatformInstructions({ filter }: { filter?: string }) {
  const items = filter
    ? platforms.filter((p) => p.id === filter)
    : platforms;

  return (
    <div className="flex flex-col gap-3">
      {items.map((platform) => (
        <div
          key={platform.id}
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden"
        >
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.04]">
            <platform.icon
              className="h-4 w-4 shrink-0"
              style={{ color: platform.color }}
            />
            <span className="text-[13px] font-medium text-[#EDEEF1]">
              {platform.name}
            </span>
          </div>
          <ol className="px-4 py-3 space-y-1.5">
            {platform.steps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[12px] text-[#8B8FA3]"
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[10px] font-medium text-[#565A6E]">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
