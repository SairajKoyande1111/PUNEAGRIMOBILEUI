import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import ocrRouter from "./ocr";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(ocrRouter);

export default router;
