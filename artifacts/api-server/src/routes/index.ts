import { Router, type IRouter } from "express";
import healthRouter from "./health";
import yahooRouter from "./yahoo";
import etfdataRouter from "./etfdata";
import fmpRouter from "./fmp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(yahooRouter);
router.use(etfdataRouter);
router.use(fmpRouter);

export default router;
