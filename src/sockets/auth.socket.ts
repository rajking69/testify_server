import { Server, Socket } from 'socket.io';
import { auth } from '../lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import { Exam } from '../models/exam.model';
import { ExamAttempt } from '../models/exam-attempt.model';

export interface AuthenticatedSocketUser {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
}

// Extend Socket interface to include authenticated user
declare module 'socket.io' {
  interface Socket {
    user?: AuthenticatedUser;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
}

/**
 * Socket authentication middleware
 * Validates session from cookie headers in socket handshake
 */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void) {
  try {
    // Extract cookies from handshake headers
    const cookieHeader = socket.handshake.headers.cookie;
    
    if (!cookieHeader) {
      return next(new Error('Authentication required'));
    }

    // Create headers object compatible with fromNodeHeaders
    const headers = {
      cookie: cookieHeader,
    };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });

    if (!session || !session.user) {
      return next(new Error('Invalid or expired session'));
    }

    const user: AuthenticatedUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: ((session.user as any).role as 'student' | 'teacher' | 'admin') || 'student',
    };

    socket.data.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
}

/**
 * Validate student identity for monitoring events
 * Ensures the socket user matches the studentId in payload
 */
export function validateStudentIdentity(socket: Socket, payloadStudentId: string): boolean {
  const user = socket.data.user;
  if (!user) return false;
  
  // Admin can act on behalf of any student
  if (user.role === 'admin') return true;
  
  // Student can only act as themselves
  if (user.role === 'student') {
    return user.id === payloadStudentId || user.email === payloadStudentId;
  }
  
  // Teacher cannot send student telemetry
  return false;
}

/**
 * Validate teacher authorization for exam monitoring
 * Ensures the teacher owns the exam or is admin
 */
export async function validateTeacherExamAccess(socket: Socket, examId: string): Promise<boolean> {
  const user = socket.data.user;
  if (!user) return false;
  
  // Admin has access to all exams
  if (user.role === 'admin') return true;
  
  // Only teachers can monitor
  if (user.role !== 'teacher') return false;
  
  try {
    const exam = await Exam.findById(examId);
    if (!exam) return false;
    
    // Check if teacher owns this exam (by ID or email)
    const isOwner = exam.teacherId === user.id || exam.teacherEmail === user.email;
    return isOwner;
  } catch (error) {
    return false;
  }
}

/**
 * Validate teacher warning authorization
 * Teacher must own the exam the student is taking
 */
export async function validateTeacherWarning(socket: Socket, studentId: string, examId: string): Promise<boolean> {
  const user = socket.data.user;
  if (!user) return false;
  
  // Admin can send warnings to anyone
  if (user.role === 'admin') return true;
  
  // Only teachers can send warnings
  if (user.role !== 'teacher') return false;
  
  try {
    // Verify teacher owns the exam
    const exam = await Exam.findById(examId);
    if (!exam) return false;
    
    const isOwner = exam.teacherId === user.id || exam.teacherEmail === user.email;
    if (!isOwner) return false;
    
    // Verify student is actually taking this exam
    const attempt = await ExamAttempt.findOne({
      examId,
      studentId,
      status: 'in_progress'
    });
    
    return !!attempt;
  } catch (error) {
    return false;
  }
}

/**
 * Validate student's exam membership
 * Student must have an active attempt for the exam
 */
export async function validateStudentExamMembership(studentId: string, examId: string): Promise<boolean> {
  try {
    const attempt = await ExamAttempt.findOne({
      examId,
      studentId,
      status: 'in_progress'
    });
    return !!attempt;
  } catch (error) {
    return false;
  }
}