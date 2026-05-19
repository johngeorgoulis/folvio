import { Router, type IRouter } from "express";
import healthRouter from "./health";
import yahooRouter from "./yahoo";
import etfdataRouter from "./etfdata";
import fmpRouter from "./fmp";
import insightsRouter from "./insights";
import eodhdRouter from "./eodhd";

const router: IRouter = Router();

router.use(healthRouter);
router.use(yahooRouter);
router.use(etfdataRouter);
router.use(fmpRouter);
router.use(insightsRouter);
router.use(eodhdRouter);

export default router;
