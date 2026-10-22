import { Router, type IRouter } from "express";
import {
  AskHouseholdMemoryBody,
  AskHouseholdMemoryResponse,
  CreateHouseholdMemoryBody,
  CreateHouseholdMemoryResponse,
  DeleteHouseholdMemoryParams,
  GetHouseholdSummaryResponse,
  ListHouseholdActivityResponse,
  ListHouseholdMemoriesQueryParams,
  ListHouseholdMemoriesResponse,
  UpdateHouseholdMemoryBody,
  UpdateHouseholdMemoryParams,
  UpdateHouseholdMemoryResponse,
} from "@workspace/api-zod";
import {
  answerHouseholdQuestion,
  createHouseholdMemory,
  deleteHouseholdMemory,
  getHouseholdSummary,
  listHouseholdActivity,
  listHouseholdMemories,
  updateHouseholdMemory,
} from "../lib/household";

const router: IRouter = Router();

router.get("/household/memories", async (req, res): Promise<void> => {
  const query = ListHouseholdMemoriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const memories = await listHouseholdMemories({
    q: query.data.q,
    category: query.data.category,
  });
  res.json(ListHouseholdMemoriesResponse.parse(memories));
});

router.post("/household/memories", async (req, res): Promise<void> => {
  const parsed = CreateHouseholdMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const memory = await createHouseholdMemory(parsed.data);
  res.status(201).json(CreateHouseholdMemoryResponse.parse(memory));
});

router.patch("/household/memories/:id", async (req, res): Promise<void> => {
  const params = UpdateHouseholdMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateHouseholdMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const memory = await updateHouseholdMemory(params.data.id, parsed.data);
  if (!memory) {
    res.status(404).json({ error: "Household memory not found" });
    return;
  }
  res.json(UpdateHouseholdMemoryResponse.parse(memory));
});

router.delete("/household/memories/:id", async (req, res): Promise<void> => {
  const params = DeleteHouseholdMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await deleteHouseholdMemory(
    params.data.id,
    "Household member",
  );
  if (!deleted) {
    res.status(404).json({ error: "Household memory not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/household/summary", async (_req, res): Promise<void> => {
  const summary = await getHouseholdSummary();
  res.json(GetHouseholdSummaryResponse.parse(summary));
});

router.get("/household/activity", async (_req, res): Promise<void> => {
  const activity = await listHouseholdActivity();
  res.json(ListHouseholdActivityResponse.parse(activity));
});

router.post("/household/ask", async (req, res): Promise<void> => {
  const parsed = AskHouseholdMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const answer = await answerHouseholdQuestion(parsed.data.question);
  res.json(AskHouseholdMemoryResponse.parse(answer));
});

export default router;
