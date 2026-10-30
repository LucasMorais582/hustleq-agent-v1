import { prisma } from "../lib/prisma.js";
import { DemoCapacityError, getDemoProfile, getDemoProfileImage } from "./demoProfile.service.js";
import { DemoInputError, generateDemoIdea, parseAnswers } from "./demoIdea.service.js";
import { SocialDataError } from "./socialData.client.js";

/*
  Public endpoints for the Meet Duke page on the landing.
  The page only reads responses with { ok: true }.
*/

export async function getNichesController(req: any, res: any) {
  try {
    const niches = await prisma.demoNiche.findMany({
      where: { active: true },
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { key: true, label: true },
    });

    return res.json({ ok: true, niches });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: "Failed to load niches" });
  }
}

export async function demoProfileController(req: any, res: any) {
  const handle = String(req.body?.handle || "");

  if (!/^@?[A-Za-z0-9._]{1,30}$/.test(handle.trim())) {
    return res.status(400).json({ ok: false, error: "Invalid handle" });
  }

  try {
    const result = await getDemoProfile(handle);

    if (!result) {
      return res.status(404).json({ ok: false, error: "Profile not found" });
    }

    return res.json({ ok: true, ...result });

  } catch (error: any) {
    if (error instanceof DemoCapacityError || (error instanceof SocialDataError && error.status === 429)) {
      return res.status(503).json({ ok: false, error: "Demo is busy, try again later" });
    }

    console.error("[demo] profile failed:", error.message);
    return res.status(502).json({ ok: false, error: "Profile lookup failed" });
  }
}

export async function demoProfileImageController(req: any, res: any) {
  const handle = String(req.params?.handle || "");

  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    return res.status(400).end();
  }

  try {
    const image = await getDemoProfileImage(handle);
    if (!image) return res.status(404).end();

    res.set({
      "Content-Type": image.type,
      "Cache-Control": "public, max-age=86400",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return res.send(image.body);

  } catch (error: any) {
    console.error("[demo] profile image failed:", error.message);
    return res.status(404).end();
  }
}

export async function demoIdeaController(req: any, res: any) {
  let answers;

  try {
    answers = parseAnswers(req.body);
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error.message });
  }

  try {
    const idea = await generateDemoIdea(answers);
    return res.json({ ok: true, idea });

  } catch (error: any) {
    if (error instanceof DemoInputError) {
      return res.status(400).json({ ok: false, error: error.message });
    }

    console.error("[demo] idea failed:", error.message);
    return res.status(502).json({ ok: false, error: "Idea generation failed" });
  }
}
