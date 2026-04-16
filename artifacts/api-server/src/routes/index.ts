import { Router, type IRouter } from "express";
import healthRouter from "./health";
import yahooRouter from "./yahoo";
import etfdataRouter from "./etfdata";
import fmpRouter from "./fmp";
import insightsRouter from "./insights";

const router: IRouter = Router();

router.use(healthRouter);
router.use(yahooRouter);
router.use(etfdataRouter);
router.use(fmpRouter);
router.use(insightsRouter);

export default router;
