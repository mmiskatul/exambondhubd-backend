import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DifficultyLevel, OptionKey, QuestionSource, QuestionStatus, QuestionType } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class AiService {
  constructor(private prisma: PrismaService) {}

  // Generate question variant based on an existing question (saved strictly as DRAFT for admin review)
  async generateQuestionVariant(questionId: string) {
    const original = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        subject: true,
        topic: true,
        options: true,
      },
    });

    if (!original) throw new NotFoundException('Original question not found');

    const variantEn = `[AI Variant] Related to: ${original.questionEn}`;
    const variantBn = original.questionBn ? `[এআই ভ্যারিয়েন্ট] ${original.questionBn}` : null;
    const hash = crypto.createHash('sha256').update(`AI_${Date.now()}_${original.subjectId}_${variantEn}`).digest('hex');

    const draftQuestion = await this.prisma.question.create({
      data: {
        subjectId: original.subjectId,
        topicId: original.topicId,
        examId: original.examId,
        questionEn: variantEn,
        questionBn: variantBn,
        explanationEn: `AI Generated contextual explanation based on ${original.subject.titleEn}.`,
        explanationBn: `এআই প্রস্তুতকৃত ব্যাখ্যা।`,
        difficulty: original.difficulty,
        questionType: QuestionType.SINGLE_MCQ,
        sourceType: QuestionSource.AI_GENERATED,
        status: QuestionStatus.DRAFT, // MUST BE DRAFT (RULE 4)
        hash,
        options: {
          create: original.options.map((opt) => ({
            optionKey: opt.optionKey,
            textEn: `[Variant] ${opt.textEn}`,
            textBn: opt.textBn ? `[ভ্যারিয়েন্ট] ${opt.textBn}` : null,
            isCorrect: opt.isCorrect,
          })),
        },
      },
      include: {
        options: true,
        subject: true,
      },
    });

    return {
      message: 'AI Question Variant generated successfully as DRAFT for Admin Review',
      question: draftQuestion,
    };
  }
}
