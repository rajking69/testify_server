import { Server, Socket } from 'socket.io';
import { ExamAttempt } from '../models/exam-attempt.model';
import {
  socketAuthMiddleware,
  validateStudentIdentity,
  validateTeacherExamAccess,
  validateTeacherWarning,
  validateStudentExamMembership,
  AuthenticatedUser,
} from './auth.socket';

export interface CandidateTelemetry {
  id: string;
  socketId: string;
  studentId: string;
  name: string;
  email: string;
  rollNo?: string;
  examId: string;
  examTitle: string;
  progress: number;
  answeredCount: number;
  totalQuestions: number;
  timeRemaining: string;
  status: 'Normal' | 'Warning' | 'Critical';
  tabSwitches: number;
  focusLossCount: number;
  lastPing: string;
  startedAt: string;
  hasCamera?: boolean;
  latestFrame?: string;
  role?: 'student' | 'teacher';
}

// In-memory registry of actively connected students taking exams
const activeCandidates = new Map<string, CandidateTelemetry>();
// Disconnect grace timers
const disconnectTimers = new Map<string, NodeJS.Timeout>();
const completedSubmissions = new Map<string, any>();

export function initMonitoringSocket(io: Server) {
  // Apply authentication middleware to all monitoring socket connections
  io.use(socketAuthMiddleware);

  const broadcastToTeachers = (examId?: string) => {
    const list = Array.from(activeCandidates.values());
    io.to('teacher:monitoring').emit('monitoring:candidates_update', list);
    if (examId) {
      const filtered = list.filter((c) => c.examId === examId);
      io.to(`teacher:monitoring:${examId}`).emit('monitoring:candidates_update', filtered);
    }
  };

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthenticatedUser;
    if (!user) {
      socket.disconnect();
      return;
    }

    // 1. Student joins live examination
    socket.on('student:join', async (data: {
      studentId?: string;
      name?: string;
      email?: string;
      rollNo?: string;
      examId?: string;
      examTitle?: string;
      totalQuestions?: number;
    }) => {
      // Validate student identity - use authenticated user from socket
      if (!validateStudentIdentity(socket, data.studentId || data.email || '')) {
        socket.emit('error', { message: 'Unauthorized: Cannot join as another student' });
        return;
      }

      // Use authenticated user's identity as source of truth
      const candidateKey = user.id;

      // Verify exam membership if examId provided
      if (data.examId) {
        const hasMembership = await validateStudentExamMembership(user.id, data.examId);
        if (!hasMembership) {
          socket.emit('error', { message: 'Not enrolled in this exam' });
          return;
        }
      }

      // Cancel any disconnect grace timer if student reconnected
      if (disconnectTimers.has(candidateKey)) {
        clearTimeout(disconnectTimers.get(candidateKey)!);
        disconnectTimers.delete(candidateKey);
      }

      socket.join(`student:${candidateKey}`);
      if (data.examId) {
        socket.join(`exam:${data.examId}`);
      }

      const existing = activeCandidates.get(candidateKey);
      const telemetry: CandidateTelemetry = {
        id: candidateKey,
        socketId: socket.id,
        studentId: user.id,
        name: data.name || user.name || existing?.name || 'Student Candidate',
        email: user.email,
        rollNo: data.rollNo || existing?.rollNo || '',
        examId: data.examId || existing?.examId || 'general',
        examTitle: data.examTitle || existing?.examTitle || 'Live Examination',
        progress: existing?.progress || 0,
        answeredCount: existing?.answeredCount || 0,
        totalQuestions: data.totalQuestions || existing?.totalQuestions || 10,
        timeRemaining: existing?.timeRemaining || '--:--',
        status: existing?.status || 'Normal',
        tabSwitches: existing?.tabSwitches || 0,
        focusLossCount: existing?.focusLossCount || 0,
        lastPing: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        startedAt: existing?.startedAt || new Date().toISOString(),
      };

      activeCandidates.set(candidateKey, telemetry);
      socket.data.candidateKey = candidateKey;

      broadcastToTeachers(telemetry.examId);
    });

    // 2. Student streams heartbeat telemetry
    socket.on('student:telemetry', async (data: Partial<CandidateTelemetry> & { studentId?: string; examId?: string }) => {
      const candidateKey = socket.data.candidateKey;
      if (!candidateKey) return;

      // Validate that the telemetry belongs to the authenticated student
      const current = activeCandidates.get(candidateKey);
      if (current && current.studentId !== user.id) {
        // Student trying to send telemetry for another student - reject
        socket.emit('error', { message: 'Unauthorized: Cannot send telemetry for another student' });
        return;
      }

      if (current) {
        const updated: CandidateTelemetry = {
          ...current,
          progress: typeof data.progress === 'number' ? data.progress : current.progress,
          answeredCount: typeof data.answeredCount === 'number' ? data.answeredCount : current.answeredCount,
          timeRemaining: data.timeRemaining || current.timeRemaining,
          tabSwitches: typeof data.tabSwitches === 'number' ? data.tabSwitches : current.tabSwitches,
          focusLossCount: typeof data.focusLossCount === 'number' ? data.focusLossCount : current.focusLossCount,
          status: data.status || (data.tabSwitches && data.tabSwitches >= 2 ? 'Critical' : data.tabSwitches && data.tabSwitches >= 1 ? 'Warning' : current.status),
          lastPing: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };

        activeCandidates.set(candidateKey, updated);
        broadcastToTeachers(current.examId);

        // Async update DB attempt record for HTTP endpoint synchronization
        try {
          if (current.examId && current.studentId) {
            await ExamAttempt.updateOne(
              { examId: current.examId, studentId: current.studentId, status: 'in_progress' },
              {
                $set: {
                  'proctoringData.answersCount': updated.answeredCount,
                  'proctoringData.tabSwitchCount': updated.tabSwitches,
                  'proctoringData.lastPingAt': new Date(),
                },
              }
            );
          }
        } catch (err) {
          // ignore error
        }
      }
    });

    // 3.1 Student submits completed exam answers & score
    socket.on('student:submit_result', (data: any) => {
      if (!data) return;
      const emailKey = (data.studentEmail || '').trim().toLowerCase();
      const idKey = (data.studentId || data.id || '').trim().toLowerCase();
      const nameKey = (data.studentName || '').trim().toLowerCase();

      if (emailKey) completedSubmissions.set(emailKey, data);
      if (idKey) completedSubmissions.set(idKey, data);
      if (nameKey) completedSubmissions.set(nameKey, data);

      io.to('teacher:monitoring').emit('monitoring:student_submitted', data);
      if (data.examId) {
        io.to(`teacher:monitoring:${data.examId}`).emit('monitoring:student_submitted', data);
      }
    });

    // 3. Student leaves or finishes
    socket.on('student:leave', (data?: any) => {
      if (data) {
        const emailKey = (data.studentEmail || '').trim().toLowerCase();
        const idKey = (data.studentId || data.id || '').trim().toLowerCase();
        if (emailKey) completedSubmissions.set(emailKey, data);
        if (idKey) completedSubmissions.set(idKey, data);
        io.to('teacher:monitoring').emit('monitoring:student_submitted', data);
        if (data.examId) {
          io.to(`teacher:monitoring:${data.examId}`).emit('monitoring:student_submitted', data);
        }
      }
      const candidateKey = socket.data.candidateKey;
      if (candidateKey) {
        const current = activeCandidates.get(candidateKey);
        activeCandidates.delete(candidateKey);
        broadcastToTeachers(current?.examId);
      }
    });

    // 4. Teacher subscribes to monitoring feed
    socket.on('teacher:subscribe', async (data?: { examId?: string }) => {
      // Validate teacher authorization
      if (user.role !== 'teacher' && user.role !== 'admin') {
        socket.emit('error', { message: 'Unauthorized: Only teachers can monitor exams' });
        return;
      }

      if (data?.examId) {
        const hasAccess = await validateTeacherExamAccess(socket, data.examId);
        if (!hasAccess) {
          socket.emit('error', { message: 'Unauthorized: You do not own this exam' });
          return;
        }
        socket.join(`teacher:monitoring:${data.examId}`);
      }

      socket.join('teacher:monitoring');

      const allList = Array.from(activeCandidates.values());
      const filtered = data?.examId
        ? allList.filter((c) => c.examId === data.examId)
        : allList;

      // Send immediate snapshot of active candidates
      socket.emit('monitoring:candidates_update', filtered);
      socket.emit('monitoring:submissions_snapshot', Array.from(completedSubmissions.values()));
    });

    // 5. Teacher transmits warning to candidate
    socket.on('teacher:send_warning', async (data: { studentId: string; examId: string; message: string; candidateName?: string }) => {
      if (!data.studentId || !data.examId || !data.message) {
        socket.emit('error', { message: 'Missing required fields: studentId, examId, message' });
        return;
      }

      // Validate teacher authorization to send warning
      const authorized = await validateTeacherWarning(socket, data.studentId, data.examId);
      if (!authorized) {
        socket.emit('error', { message: 'Unauthorized: Cannot send warning to this student' });
        return;
      }

      const payload = {
        message: data.message,
        timestamp: new Date().toLocaleTimeString(),
      };

      // Broadcast directly to candidate's room (using their user ID as key)
      io.to(`student:${data.studentId}`).emit('proctor:warning', payload);

      // Also mark candidate status as Warning in feed
      const current = activeCandidates.get(data.studentId);
      if (current) {
        current.status = 'Warning';
        activeCandidates.set(data.studentId, current);
        broadcastToTeachers(current.examId);
      }
    });

    // 6. Teacher terminates session remotely
    socket.on('teacher:terminate_session', async (data: { studentId: string; examId: string; reason?: string }) => {
      if (!data.studentId || !data.examId) {
        socket.emit('error', { message: 'Missing required fields: studentId, examId' });
        return;
      }

      // Validate teacher authorization to terminate
      const authorized = await validateTeacherWarning(socket, data.studentId, data.examId);
      if (!authorized) {
        socket.emit('error', { message: 'Unauthorized: Cannot terminate this session' });
        return;
      }

      io.to(`student:${data.studentId}`).emit('proctor:terminate', {
        reason: data.reason || 'Session terminated by proctor due to academic integrity violation.',
      });

      const current = activeCandidates.get(data.studentId);
      if (current) {
        activeCandidates.delete(data.studentId);
        broadcastToTeachers(current.examId);
      }
    });

    // 7. Teacher requests telemetry refresh
    socket.on('teacher:request_refresh', (data?: { examId?: string }) => {
      // Verify user is a teacher or admin
      if (user.role !== 'teacher' && user.role !== 'admin') {
        socket.emit('error', { message: 'Unauthorized: Teacher role required' });
        return;
      }
      broadcastToTeachers(data?.examId);
    });

    // 9. Student transmits webcam video frame
    socket.on('student:video_frame', (data: { studentId: string; examId?: string; frame: string }) => {
      // Verify user is a student and matches candidateKey
      if (user.role !== 'student') {
        socket.emit('error', { message: 'Unauthorized: Student role required' });
        return;
      }
      const candidateKey = socket.data.candidateKey || data.studentId;
      if (candidateKey !== user.id) {
        socket.emit('error', { message: 'Unauthorized: Cannot send video for another student' });
        return;
      }
      if (!candidateKey) return;

      const current = activeCandidates.get(candidateKey);
      if (current) {
        current.hasCamera = true;
        current.latestFrame = data.frame;
      }

      const framePayload = {
        studentId: candidateKey,
        frame: data.frame,
      };

      io.to('teacher:monitoring').emit('monitoring:video_frame', framePayload);
      if (data.examId || current?.examId) {
        io.to(`teacher:monitoring:${data.examId || current?.examId}`).emit('monitoring:video_frame', framePayload);
      }
    });

    // 10. Teacher requests live video stream from student
    socket.on('teacher:request_video_stream', (data: { studentId: string }) => {
      // Verify user is a teacher or admin
      if (user.role !== 'teacher' && user.role !== 'admin') {
        socket.emit('error', { message: 'Unauthorized: Teacher role required' });
        return;
      }
      if (!data.studentId) return;
      io.to('student:' + data.studentId).emit('proctor:start_video_stream');
    });

    // 11. Teacher stops live video stream
    socket.on('teacher:stop_video_stream', (data: { studentId: string }) => {
      // Verify user is a teacher or admin
      if (user.role !== 'teacher' && user.role !== 'admin') {
        socket.emit('error', { message: 'Unauthorized: Teacher role required' });
        return;
      }
      if (!data.studentId) return;
      io.to('student:' + data.studentId).emit('proctor:stop_video_stream');
    });

    // WebRTC Signaling: Teacher sends offer
    socket.on('webrtc:offer', (data: { studentId: string; offer: any }) => {
      // Verify user is a teacher or admin
      if (user.role !== 'teacher' && user.role !== 'admin') {
        socket.emit('error', { message: 'Unauthorized: Teacher role required' });
        return;
      }
      if (!data.studentId) return;
      io.to('student:' + data.studentId).emit('webrtc:offer', {
        teacherSocketId: socket.id,
        offer: data.offer,
      });
    });

    // WebRTC Signaling: Student sends answer
    socket.on('webrtc:answer', (data: { studentId: string; teacherSocketId?: string; answer: any }) => {
      // Verify user is a student
      if (user.role !== 'student') {
        socket.emit('error', { message: 'Unauthorized: Student role required' });
        return;
      }
      if (data.teacherSocketId) {
        io.to(data.teacherSocketId).emit('webrtc:answer', {
          studentId: user.id,
          answer: data.answer,
        });
      } else {
        io.to('teacher:monitoring').emit('webrtc:answer', {
          studentId: user.id,
          answer: data.answer,
        });
      }
    });

    // WebRTC Signaling: ICE candidate exchange
    socket.on('webrtc:ice_candidate', (data: { targetStudentId?: string; targetTeacherSocketId?: string; candidate: any; fromStudentId?: string }) => {
      if (user.role === 'teacher' || user.role === 'admin') {
        // Teacher sending ICE candidate to student
        if (data.targetStudentId) {
          io.to('student:' + data.targetStudentId).emit('webrtc:ice_candidate', {
            candidate: data.candidate,
          });
        }
      } else if (user.role === 'student') {
        // Student sending ICE candidate to teacher
        if (data.targetTeacherSocketId) {
          io.to(data.targetTeacherSocketId).emit('webrtc:ice_candidate', {
            fromStudentId: user.id,
            candidate: data.candidate,
          });
        } else {
          io.to('teacher:monitoring').emit('webrtc:ice_candidate', {
            fromStudentId: user.id,
            candidate: data.candidate,
          });
        }
      }
    });

    // WebRTC Signaling: Hang up / close stream
    socket.on('webrtc:hangup', (data: { studentId: string }) => {
      // Verify user is a teacher or admin
      if (user.role !== 'teacher' && user.role !== 'admin') {
        socket.emit('error', { message: 'Unauthorized: Teacher role required' });
        return;
      }
      if (!data.studentId) return;
      io.to('student:' + data.studentId).emit('webrtc:hangup');
    });

    // 8. Handle socket disconnect (with grace period for tab refresh)
    socket.on('disconnect', () => {
      const candidateKey = socket.data.candidateKey;
      if (candidateKey && activeCandidates.has(candidateKey)) {
        // Give 12 seconds grace period in case candidate reloads the page
        const timer = setTimeout(() => {
          activeCandidates.delete(candidateKey);
          disconnectTimers.delete(candidateKey);
          broadcastToTeachers();
        }, 12000);

        disconnectTimers.set(candidateKey, timer);
      }
    });
  });
}
