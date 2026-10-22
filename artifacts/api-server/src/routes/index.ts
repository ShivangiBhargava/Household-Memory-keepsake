import { Router, type IRouter } from "express";
import healthRouter from "./health";
import householdRouter from "./household";
import mcpRouter from "./mcp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(householdRouter);
router.use(mcpRouter);

export default router;
