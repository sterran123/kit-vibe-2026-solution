import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, getDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, updateDoc,
  getDocs, addDoc
} from './firebase-init.js?v=4';

const SEND_EMAIL_URL = 'https://sendemail-yj33ol7uua-an.a.run.app';

window.adminApp = function() {
  return {
    user: null,
    instructors: [],
    filter: 'pending',
    isVerifying: null,
    imageModalOpen: false,
    modalImageUrl: '',
    stats: {
      pending: 0,
      approved: 0,
      rejected: 0,
      total: 0
    },
    
    // Course Request State
    activeSection: 'instructors',
    courseRequests: [],
    courseFilter: 'pending',
    courseSearchQuery: '',
    selectedInstructorForCourses: null,
    courseStats: {
      pending: 0,
      approved: 0,
      rejected: 0,
      total: 0
    },

    // Students State
    students: [],

    // Active Courses State
    activeCourses: [],
    activeCoursePage: 1,
    activeCoursesPerPage: 6,
    
    // Announcements State
    announcements: [],
    announcementForm: { id: null, title: '', content: '', type: 'notice', isImportant: false },
    showAnnouncementModal: false,
    showAnnouncementDetailModal: false,
    selectedAnnouncement: {},
    quillEditor: null,
    
    // Staff Management State
    approvedInstructors: [],
    showStaffPermissions: true,
    
    // Board Settings State
    boardList: [
      { id: 'free', name: '자유게시판', icon: '💬', isDefault: true, isActive: true, order: 1 },
      { id: 'question', name: '질문게시판', icon: '❓', isDefault: true, isActive: true, order: 2 },
      { id: 'attendance', name: '출석부', icon: '✅', isDefault: true, isActive: true, order: 3 },
      { id: 'gallery', name: '갤러리', icon: '🖼️', isDefault: true, isActive: true, order: 4 }
    ],
    boardForm: { id: null, name: '', icon: '📋', isActive: true },
    showBoardModal: false,

    // Inquiry State
    inquiries: [],
    inquiryFilter: 'all',
    inquiryStats: { pending: 0, responded: 0, closed: 0 },
    showInquiryModal: false,
    selectedInquiry: null,
    inquiryResponses: [],
    inquiryResponse: '',
    isSubmitting: false,

    async init() {
      // Check authentication
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          console.log('Current user UID:', user.uid);
          console.log('Current user email:', user.email);
          
          try {
            // Check if admin - check admins collection
            const adminDocRef = doc(db, 'admins', user.uid);
            console.log('Checking admin doc at path:', `admins/${user.uid}`);
            
            // Manual override for testing - set localStorage.setItem('tb_admin_override', 'true')
            if (localStorage.getItem('tb_admin_override') === 'true') {
              console.log('Admin access granted via localStorage override');
              this.loadInstructors();
              return;
            }
            
            const adminDoc = await getDoc(adminDocRef);
            console.log('Admin doc exists:', adminDoc.exists());
            
            if (adminDoc.exists()) {
              console.log('Admin doc data:', adminDoc.data());
            } else {
              console.log('No admin document found. Checking users collection for role...');
              // Fallback: Check if user has admin role in users collection
              const userDoc = await getDoc(doc(db, 'users', user.uid));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                console.log('User doc role:', userData.role);
                if (userData.role === 'admin') {
                  console.log('Admin access granted via users collection');
                  this.loadInstructors();
                  return;
                }
              }
              
              Swal.fire({
                icon: 'error',
                title: '접근 권한 없음',
                text: '관리자 권한이 필요합니다.',
                confirmButtonColor: '#2563eb'
              }).then(() => {
                window.location.href = 'login.html';
              });
              return;
            }
            
            // Load instructor applications
            this.loadInstructors();
            // Load course requests
            this.loadCourseRequests();
            // Load students
            this.loadStudents();
            // Load active courses
            this.loadActiveCourses();
            // Load inquiries (for admin)
            this.loadInquiries();
            // Load announcements
            this.loadAnnouncements();
            // Load approved instructors for staff management
            this.loadApprovedInstructors();
          } catch (error) {
            console.error('Error checking admin status:', error);
            Swal.fire({
              icon: 'error',
              title: '오류 발생',
              text: '관리자 권한 확인 중 오류가 발생했습니다: ' + error.message,
              confirmButtonColor: '#2563eb'
            }).then(() => {
              window.location.href = 'login.html';
            });
          }
        } else {
          window.location.href = 'login.html';
        }
      });
    },
    
    loadInstructors() {
      const q = query(
        collection(db, 'users'),
        where('role', 'in', ['instructor', 'staff']),
        orderBy('created_at', 'desc')
      );
      
      onSnapshot(q, (snapshot) => {
        this.instructors = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        this.updateStats();
      });
    },
    
    updateStats() {
      this.stats.pending = this.instructors.filter(i => i.status === 'pending').length;
      // admin, staff도 승인된 강사로 카운트
      this.stats.approved = this.instructors.filter(i => i.status === 'active' || i.role === 'admin' || i.role === 'staff').length;
      this.stats.rejected = this.instructors.filter(i => i.status === 'rejected').length;
      this.stats.total = this.instructors.length;
    },
    
    loadCourseRequests() {
      const q = query(
        collection(db, 'courseRequests'),
        orderBy('createdAt', 'desc')
      );
      
      onSnapshot(q, (snapshot) => {
        this.courseRequests = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        this.updateCourseStats();
      });
    },
    
    updateCourseStats() {
      this.courseStats.pending = this.courseRequests.filter(c => c.status === 'pending').length;
      this.courseStats.approved = this.courseRequests.filter(c => c.status === 'approved').length;
      this.courseStats.rejected = this.courseRequests.filter(c => c.status === 'rejected').length;
      this.courseStats.total = this.courseRequests.length;
    },

    // Load students from Firestore (role === 'student')
    loadStudents() {
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'student'),
        orderBy('created_at', 'desc')
      );
      onSnapshot(q, async (snapshot) => {
        const studentsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Count enrollments for each student (parallel)
        await Promise.all(studentsData.map(async (student) => {
          try {
            const enrollQ = query(
              collection(db, 'courseEnrollments'),
              where('studentId', '==', student.id),
              where('status', '==', 'approved')
            );
            const enrollSnap = await getDocs(enrollQ);
            student.enrollmentCount = enrollSnap.size;
          } catch (e) {
            student.enrollmentCount = 0;
          }
        }));

        this.students = studentsData;
      }, (err) => {
        console.warn('Students load error:', err);
        this.students = [];
      });
    },

    // Load active (approved) courses for gallery view
    loadActiveCourses() {
      const q = query(
        collection(db, 'courseRequests'),
        where('status', '==', 'approved')
      );
      onSnapshot(q, (snapshot) => {
        this.activeCourses = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        this.activeCoursePage = 1;
      }, (err) => {
        console.warn('Active courses load error:', err);
        this.activeCourses = [];
      });
    },

    // Paginated active courses (6 per page)
    get paginatedActiveCourses() {
      const start = (this.activeCoursePage - 1) * this.activeCoursesPerPage;
      return this.activeCourses.slice(start, start + this.activeCoursesPerPage);
    },

    get activeCoursePages() {
      return Math.max(1, Math.ceil(this.activeCourses.length / this.activeCoursesPerPage));
    },

    get activeCoursePageList() {
      const total = Math.max(1, Math.ceil(this.activeCourses.length / this.activeCoursesPerPage));
      return Array.from({ length: total }, (_, i) => i + 1);
    },

    // Filtered instructors with courses (by courseSearchQuery)
    get filteredInstructorsWithCourses() {
      const q = (this.courseSearchQuery || '').toLowerCase().trim();
      if (!q) return this.instructorsWithCourses;
      return this.instructorsWithCourses.filter(inst =>
        (inst.name || '').toLowerCase().includes(q) ||
        this.courseRequests.some(c =>
          c.instructorId === inst.id &&
          (c.title || '').toLowerCase().includes(q)
        )
      );
    },

    // Get unique instructors who have course requests
    get instructorsWithCourses() {
      const map = new Map();
      this.courseRequests.forEach(c => {
        if (!map.has(c.instructorId)) {
          map.set(c.instructorId, {
            id: c.instructorId,
            name: c.instructorName,
            email: c.instructorEmail,
            pendingCount: 0,
            approvedCount: 0,
            rejectedCount: 0,
            totalCount: 0
          });
        }
        const inst = map.get(c.instructorId);
        inst.totalCount++;
        if (c.status === 'pending') inst.pendingCount++;
        else if (c.status === 'approved') inst.approvedCount++;
        else if (c.status === 'rejected') inst.rejectedCount++;
      });
      return Array.from(map.values());
    },
    
    // Get filtered courses for selected instructor
    get filteredInstructorCourses() {
      if (!this.selectedInstructorForCourses) return [];
      
      const instructorCourses = this.courseRequests.filter(c => 
        c.instructorId === this.selectedInstructorForCourses.id
      );
      
      if (this.courseFilter === 'all') {
        return instructorCourses;
      }
      return instructorCourses.filter(c => {
        if (this.courseFilter === 'pending') return c.status === 'pending';
        if (this.courseFilter === 'approved') return c.status === 'approved';
        if (this.courseFilter === 'rejected') return c.status === 'rejected';
        return true;
      });
    },
    
    // Get selected instructor's pending courses count
    get selectedInstructorPendingCount() {
      if (!this.selectedInstructorForCourses) return 0;
      return this.courseRequests.filter(c => 
        c.instructorId === this.selectedInstructorForCourses.id && c.status === 'pending'
      ).length;
    },
    
    selectInstructorForCourses(instructor) {
      this.selectedInstructorForCourses = instructor;
      this.courseFilter = 'pending'; // Default to pending
    },
    
    backToInstructorList() {
      this.selectedInstructorForCourses = null;
      this.courseFilter = 'pending';
    },
    
    getCategoryText(category) {
      const categoryMap = {
        'programming': '프로그래밍',
        'math': '수학',
        'science': '과학',
        'english': '영어',
        'korean': '국어',
        'history': '역사',
        'art': '미술',
        'music': '음악',
        'other': '기타'
      };
      return categoryMap[category] || category;
    },
    
    getTargetGradeText(grade) {
      const gradeMap = {
        'elementary': '초등학생',
        'middle': '중학생',
        'high': '고등학생',
        'adult': '성인',
        'all': '전체'
      };
      return gradeMap[grade] || grade;
    },
    
    getCourseStatusText(status) {
      const statusMap = {
        'pending': '대기중',
        'approved': '승인됨',
        'rejected': '거절됨'
      };
      return statusMap[status] || status;
    },
    
    async approveCourse(course) {
      const result = await Swal.fire({
        icon: 'question',
        title: '강의 승인',
        text: `${course.title} 강의를 승인하시겠습니까?`,
        showCancelButton: true,
        confirmButtonText: '승인',
        cancelButtonText: '취소',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280'
      });
      
      if (result.isConfirmed) {
        try {
          console.log('Approving course:', course.id);
          
          await updateDoc(doc(db, 'courseRequests', course.id), {
            status: 'approved',
            approvedAt: serverTimestamp(),
            approvedBy: this.user.uid,
            updatedAt: serverTimestamp()
          });
          
          console.log('Course status updated to approved');
          
          // Create notification for instructor with detailed info
          const notificationData = {
            user_id: course.instructorId,
            type: 'course_approved',
            title: '강의 개설 승인 완료',
            message: `"${course.title}" 강의 개설이 승인되었습니다. 이제 학생들이 수강 신청할 수 있습니다.`,
            courseId: course.id,
            courseTitle: course.title,
            read: false,
            created_at: serverTimestamp()
          };
          
          console.log('Creating notification:', notificationData);
          
          const notificationRef = await addDoc(collection(db, 'notifications'), notificationData);
          console.log('Notification created with ID:', notificationRef.id);
          
          // Update local courseRequests array immediately for reactive update
          const courseIndex = this.courseRequests.findIndex(c => c.id === course.id);
          if (courseIndex !== -1) {
            this.courseRequests[courseIndex] = {
              ...this.courseRequests[courseIndex],
              status: 'approved',
              approvedAt: new Date()
            };
            // Force Alpine to detect the change
            this.courseRequests = [...this.courseRequests];
            console.log('Local courseRequests updated');
          }
          
          Swal.fire({
            icon: 'success',
            title: '승인 완료',
            text: '강의 개설이 승인되었으며, 강사에게 알림이 전송되었습니다.',
            timer: 2000,
            showConfirmButton: false
          });
          
        } catch (error) {
          console.error('Course approval error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류',
            text: '승인 처리 중 오류가 발생했습니다: ' + error.message,
            confirmButtonColor: '#2563eb'
          });
        }
      }
    },
    
    async rejectCourse(course) {
      const { value: reason } = await Swal.fire({
        icon: 'warning',
        title: '강의 거절',
        text: '거절 사유를 입력해주세요:',
        input: 'textarea',
        inputPlaceholder: '거절 사유를 입력하세요...',
        showCancelButton: true,
        confirmButtonText: '거절',
        cancelButtonText: '취소',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280'
      });
      
      if (reason) {
        try {
          console.log('Rejecting course:', course.id, 'for instructor:', course.instructorId);
          
          // Update course status
          await updateDoc(doc(db, 'courseRequests', course.id), {
            status: 'rejected',
            rejectedAt: serverTimestamp(),
            rejectedBy: this.user.uid,
            rejectionReason: reason,
            updatedAt: serverTimestamp()
          });
          
          console.log('Course status updated to rejected');
          
          // Create notification for instructor with detailed info
          const notificationData = {
            user_id: course.instructorId,
            type: 'course_rejected',
            title: '강의 개설 신청 거절',
            message: `"${course.title}" 강의 개설 신청이 거절되었습니다.\n거절 사유: ${reason}`,
            courseId: course.id,
            courseTitle: course.title,
            read: false,
            created_at: serverTimestamp()
          };
          
          console.log('Creating notification:', notificationData);
          
          const notificationRef = await addDoc(collection(db, 'notifications'), notificationData);
          console.log('Notification created with ID:', notificationRef.id);
          
          // Update local courseRequests array immediately for reactive update
          const courseIndex = this.courseRequests.findIndex(c => c.id === course.id);
          if (courseIndex !== -1) {
            this.courseRequests[courseIndex] = {
              ...this.courseRequests[courseIndex],
              status: 'rejected',
              rejectedAt: new Date(),
              rejectionReason: reason
            };
            // Force Alpine to detect the change
            this.courseRequests = [...this.courseRequests];
            console.log('Local courseRequests updated');
          }
          
          Swal.fire({
            icon: 'success',
            title: '거절 처리 완료',
            text: '강의 개설 신청이 거절되었으며, 강사에게 알림이 전송되었습니다.',
            timer: 2000,
            showConfirmButton: false
          });
          
        } catch (error) {
          console.error('Course rejection error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류',
            text: '거절 처리 중 오류가 발생했습니다: ' + error.message,
            confirmButtonColor: '#2563eb'
          });
        }
      }
    },
    
    async createNotification(userId, type, title, message) {
      try {
        await addDoc(collection(db, 'notifications'), {
          user_id: userId,
          type: type,
          title: title,
          message: message,
          read: false,
          created_at: serverTimestamp()
        });
      } catch (error) {
        console.error('Create notification error:', error);
      }
    },
    
    get filteredInstructors() {
      if (this.filter === 'all') {
        return this.instructors;
      }
      return this.instructors.filter(i => {
        if (this.filter === 'pending') return i.status === 'pending';
        // 승인됨: status가 active이거나 role이 admin/staff인 경우
        if (this.filter === 'approved') return i.status === 'active' || i.role === 'admin' || i.role === 'staff';
        if (this.filter === 'rejected') return i.status === 'rejected';
        return true;
      });
    },
    
    async approveInstructor(instructor) {
      if (!instructor.emailVerified) {
        Swal.fire({
          icon: 'warning',
          title: '이메일 미인증',
          text: '이메일 인증이 완료된 후 승인 가능합니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      const result = await Swal.fire({
        icon: 'question',
        title: '강사 승인',
        text: `${instructor.displayName}님을 강사로 승인하시겠습니까?`,
        showCancelButton: true,
        confirmButtonText: '승인',
        cancelButtonText: '취소',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280'
      });
      
      if (result.isConfirmed) {
        try {
          await updateDoc(doc(db, 'users', instructor.id), {
            status: 'active',
            approvedAt: serverTimestamp(),
            approvedBy: this.user.uid,
            updated_at: serverTimestamp()
          });
          
          Swal.fire({
            icon: 'success',
            title: '승인 완료',
            text: '강사 승인이 완료되었습니다.',
            timer: 2000,
            showConfirmButton: false
          });
          
          // Send approval email
          this.sendEmail(instructor.email, 'TutorBridge 강사 승인 완료', `
            <h2>축하합니다! 강사 승인이 완료되었습니다.</h2>
            <p>${instructor.displayName}님, TutorBridge 강사로 승인되었습니다.</p>
            <p>이제 강사 대시보드에 접속하여 학생들의 질문에 답변하실 수 있습니다.</p>
            <p><a href="${window.location.origin}/instructor.html">강사 대시보드 바로가기</a></p>
          `);
        } catch (error) {
          console.error('Approval error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류',
            text: '승인 처리 중 오류가 발생했습니다.',
            confirmButtonColor: '#2563eb'
          });
        }
      }
    },
    
    async rejectInstructor(instructor) {
      const { value: reason } = await Swal.fire({
        icon: 'warning',
        title: '강사 거절',
        text: '거절 사유를 입력해주세요:',
        input: 'textarea',
        inputPlaceholder: '거절 사유를 입력하세요...',
        showCancelButton: true,
        confirmButtonText: '거절',
        cancelButtonText: '취소',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280'
      });
      
      if (reason) {
        try {
          await updateDoc(doc(db, 'users', instructor.id), {
            status: 'rejected',
            rejectedAt: serverTimestamp(),
            rejectedBy: this.user.uid,
            rejectionReason: reason,
            updated_at: serverTimestamp()
          });
          
          Swal.fire({
            icon: 'success',
            title: '거절 처리 완료',
            text: '강사 신청이 거절되었습니다.',
            timer: 2000,
            showConfirmButton: false
          });
          
          // Send rejection email
          this.sendEmail(instructor.email, 'TutorBridge 강사 신청 결과', `
            <h2>강사 신청 결과 안내</h2>
            <p>${instructor.displayName}님, 강사 신청을 검토한 결과 아래와 같은 사유로 인해 승인이 어렵습니다.</p>
            <p><strong>거절 사유:</strong></p>
            <p>${reason}</p>
            <p>궁금한 점이 있으시면 support@tutorbridge.com으로 문의해 주세요.</p>
          `);
        } catch (error) {
          console.error('Rejection error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류',
            text: '거절 처리 중 오류가 발생했습니다.',
            confirmButtonColor: '#2563eb'
          });
        }
      }
    },
    
    async runAIVerification(instructor) {
      if (!instructor.certificateUrl) {
        Swal.fire({
          icon: 'warning',
          title: '강사증 없음',
          text: '업로드된 강사증이 없습니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      this.isVerifying = instructor.id;
      
      try {
        // Call Cloud Function directly with image URL (no CORS issues)
        const verifyResponse = await fetch('https://verifycertificate-yj33ol7uua-uc.a.run.app', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            imageUrl: instructor.certificateUrl,
            expectedName: instructor.displayName,
            expectedBirthDate: instructor.birthDate
          })
        });
        
        if (!verifyResponse.ok) {
          const errorText = await verifyResponse.text();
          throw new Error(`Verification failed: ${errorText}`);
        }
        
        const result = await verifyResponse.json();
        
        // Save verification result
        await updateDoc(doc(db, 'users', instructor.id), {
          aiVerification: result,
          certificateAIVerified: result.isValidCertificate && result.nameMatch,
          updated_at: serverTimestamp()
        });
        
        Swal.fire({
          icon: result.isValidCertificate && result.nameMatch ? 'success' : 'warning',
          title: 'AI 검증 완료',
          html: `
            <div style="text-align: left;">
              <p><strong>강사증 유효성:</strong> ${result.isValidCertificate ? '✓ 유효함' : '✗ 유효하지 않음'}</p>
              <p><strong>이름 일치:</strong> ${result.nameMatch ? '✓ 일치' : '✗ 불일치'}</p>
              <p><strong>생년월일 일치:</strong> ${result.birthDateMatch ? '✓ 일치' : '✗ 불일치'}</p>
              <p><strong>신뢰도:</strong> ${((result.overallConfidence || 0) * 100).toFixed(1)}%</p>
              <p style="margin-top: 10px;">${result.reason}</p>
            </div>
          `,
          confirmButtonColor: '#2563eb'
        });
        
      } catch (error) {
        console.error('AI verification error:', error);
        Swal.fire({
          icon: 'error',
          title: '검증 실패',
          text: 'AI 검증 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isVerifying = null;
      }
    },
    
    async sendNotificationEmail(instructor) {
      const subject = instructor.status === 'active' 
        ? 'TutorBridge 강사 승인 완료 안내'
        : 'TutorBridge 강사 신청 결과 안내';
      
      const html = instructor.status === 'active'
        ? `<h2>축하합니다! 강사 승인이 완료되었습니다 🎉</h2>
           <p>${instructor.displayName}님, TutorBridge 강사로 승인되었습니다.</p>
           <p>이제 강사 대시보드에 접속하여 학생들의 질문에 답변하실 수 있습니다.</p>
           <p><a href="${window.location.origin}/instructor.html" style="display: inline-block; margin-top: 20px; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px;">강사 대시보드 바로가기</a></p>`
        : `<h2>강사 신청 결과 안내</h2>
           <p>${instructor.displayName}님, 강사 신청을 검토한 결과 승인이 어렵습니다.</p>
           <p>궁금한 점이 있으시면 support@tutorbridge.com으로 문의해 주세요.</p>`;
      
      await this.sendEmail(instructor.email, subject, html);
    },
    
    async sendEmail(to, subject, html) {
      try {
        const response = await fetch(SEND_EMAIL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
          },
          body: JSON.stringify({ to, subject, html })
        });
        
        if (!response.ok) {
          throw new Error('Email send failed');
        }
        
        Swal.fire({
          icon: 'success',
          title: '이메일 발송',
          text: '이메일이 발송되었습니다.',
          timer: 2000,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Send email error:', error);
        Swal.fire({
          icon: 'error',
          title: '발송 실패',
          text: '이메일 발송 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    openImageModal(url) {
      this.modalImageUrl = url;
      this.imageModalOpen = true;
    },
    
    // Load announcements from Firestore
    loadAnnouncements() {
      const q = query(
        collection(db, 'announcements'),
        orderBy('created_at', 'desc')
      );
      
      onSnapshot(q, (snapshot) => {
        this.announcements = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      }, (err) => {
        console.warn('Announcements load error:', err);
        this.announcements = [];
      });
    },
    
    // Create new announcement
    async createAnnouncement() {
      if (!this.announcementForm.title.trim() || !this.announcementForm.content.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '입력 확인',
          text: '제목과 내용을 모두 입력해주세요.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      try {
        await addDoc(collection(db, 'announcements'), {
          title: this.announcementForm.title.trim(),
          content: this.announcementForm.content.trim(),
          type: this.announcementForm.type,
          isImportant: this.announcementForm.isImportant,
          created_at: serverTimestamp(),
          createdBy: this.user.uid
        });
        
        // Reset form and close modal
        this.announcementForm = { id: null, title: '', content: '', type: 'notice', isImportant: false };
        this.showAnnouncementModal = false;
        this.quillEditor = null;
        
        Swal.fire({
          icon: 'success',
          title: '등록 완료',
          text: '공지사항이 등록되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Create announcement error:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '공지사항 등록 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    // Delete announcement
    async deleteAnnouncement(announcementId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '삭제 확인',
        text: '이 공지사항을 삭제하시겠습니까?',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280'
      });
      
      if (result.isConfirmed) {
        try {
          const { deleteDoc, doc } = await import('./firebase-init.js');
          await deleteDoc(doc(db, 'announcements', announcementId));
          
          Swal.fire({
            icon: 'success',
            title: '삭제 완료',
            text: '공지사항이 삭제되었습니다.',
            timer: 1500,
            showConfirmButton: false
          });
        } catch (error) {
          console.error('Delete announcement error:', error);
          Swal.fire({
            icon: 'error',
            title: '오류',
            text: '공지사항 삭제 중 오류가 발생했습니다.',
            confirmButtonColor: '#2563eb'
          });
        }
      }
    },
    
    // Open announcement detail modal
    openAnnouncementDetail(announcement) {
      this.selectedAnnouncement = { ...announcement };
      this.showAnnouncementDetailModal = true;
    },
    
    // Open edit modal from detail view
    closeDetailAndEdit() {
      this.showAnnouncementDetailModal = false;
      this.openEditModal(this.selectedAnnouncement);
    },
    
    // Open new announcement modal
    openNewAnnouncementModal() {
      this.announcementForm = { id: null, title: '', content: '', type: 'notice', isImportant: false };
      this.showAnnouncementModal = true;
      
      // Initialize Quill editor after modal opens
      this.$nextTick(() => {
        this.initQuillEditor();
      });
    },
    
    // Open edit modal
    openEditModal(announcement) {
      this.announcementForm = {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        isImportant: announcement.isImportant || false
      };
      this.showAnnouncementModal = true;
      
      // Initialize Quill editor after modal opens
      this.$nextTick(() => {
        this.initQuillEditor();
      });
    },
    
    // Initialize Quill editor
    initQuillEditor() {
      const editorContainer = document.getElementById('announcement-editor');
      if (!editorContainer) return;
      
      // Destroy existing editor if any
      if (this.quillEditor) {
        this.quillEditor = null;
        editorContainer.innerHTML = '';
      }
      
      this.quillEditor = new Quill('#announcement-editor', {
        theme: 'snow',
        placeholder: '공지사항 내용을 입력하세요...',
        modules: {
          toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'align': [] }],
            ['link', 'image', 'video'],
            ['clean']
          ]
        }
      });
      
      // Set content if editing
      if (this.announcementForm.content) {
        this.quillEditor.root.innerHTML = this.announcementForm.content;
      }
      
      // Update form content on change
      this.quillEditor.on('text-change', () => {
        this.announcementForm.content = this.quillEditor.root.innerHTML;
      });
    },
    
    // Update existing announcement
    async updateAnnouncement() {
      if (!this.announcementForm.title.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '입력 확인',
          text: '제목을 입력해주세요.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      if (!this.announcementForm.content.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '입력 확인',
          text: '내용을 입력해주세요.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      try {
        const { updateDoc, doc } = await import('./firebase-init.js');
        await updateDoc(doc(db, 'announcements', this.announcementForm.id), {
          title: this.announcementForm.title.trim(),
          content: this.announcementForm.content.trim(),
          isImportant: this.announcementForm.isImportant,
          updated_at: serverTimestamp()
        });
        
        // Reset form and close modal
        this.announcementForm = { id: null, title: '', content: '', type: 'notice', isImportant: false };
        this.showAnnouncementModal = false;
        this.quillEditor = null;
        
        Swal.fire({
          icon: 'success',
          title: '수정 완료',
          text: '공지사항이 수정되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Update announcement error:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '공지사항 수정 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    // Format relative time
    formatRelativeTime(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return '방금 전';
      if (minutes < 60) return `${minutes}분 전`;
      if (hours < 24) return `${hours}시간 전`;
      if (days < 7) return `${days}일 전`;
      return this.formatDate(timestamp);
    },
    
    getStatusText(status) {
      const statusMap = {
        'pending': '대기중',
        'active': '승인됨',
        'rejected': '거절됨'
      };
      return statusMap[status] || status;
    },
    
    getInitials(name) {
      if (!name) return '?';
      return name.charAt(0).toUpperCase();
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    },
    
    // Load approved instructors for staff management
    async loadApprovedInstructors() {
      const q = query(
        collection(db, 'users'),
        where('role', 'in', ['instructor', 'staff']),
        where('status', '==', 'active')
      );
      
      onSnapshot(q, (snapshot) => {
        this.approvedInstructors = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          permissions: doc.data().permissions || {
            deletePost: false,
            deleteComment: false,
            manageStaff: false
          }
        }));
      });
    },

    // Assign staff role to instructor
    async assignStaff(instructorId) {
      // Admin 권한 보호: admin은 staff로 변경 불가
      const instructor = this.approvedInstructors.find(i => i.id === instructorId);
      if (instructor?.role === 'admin') {
        Swal.fire({
          icon: 'warning',
          title: '관리자 권한',
          text: '관리자 계정은 스태프로 지정할 수 없습니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      try {
        await updateDoc(doc(db, 'users', instructorId), {
          role: 'staff',
          permissions: {
            deletePost: true,
            deleteComment: true,
            manageStaff: false
          }
        });

        Swal.fire({
          icon: 'success',
          title: '스태프 지정 완료',
          text: '해당 강사가 스태프로 지정되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Assign staff error:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '스태프 지정 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },

    // Revoke staff role
    async revokeStaff(instructorId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '스태프 권한을 해제하시겠습니까?',
        text: '해제 후 해당 강사는 일반 강사로 돌아갑니다.',
        showCancelButton: true,
        confirmButtonText: '해제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });

      if (!result.isConfirmed) return;

      try {
        await updateDoc(doc(db, 'users', instructorId), {
          role: 'instructor',
          permissions: {}
        });

        Swal.fire({
          icon: 'success',
          title: '권한 해제 완료',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Revoke staff error:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '권한 해제 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },

    // Update staff permissions
    async updateStaffPermissions(instructorId, permission, value) {
      try {
        const instructor = this.approvedInstructors.find(i => i.id === instructorId);
        if (!instructor) return;

        const updatedPermissions = {
          ...instructor.permissions,
          [permission]: value
        };

        await updateDoc(doc(db, 'users', instructorId), {
          permissions: updatedPermissions
        });

        // Update local state
        instructor.permissions = updatedPermissions;

        Swal.fire({
          icon: 'success',
          title: '권한 업데이트 완료',
          timer: 1000,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Update permissions error:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '권한 업데이트 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async logout() {
      await signOut(auth);
      window.location.href = 'login.html';
    },

    // ========== Board Settings Methods ==========
    
    // 게시판 순서 변경
    moveBoard(index, direction) {
      if (direction === -1 && index === 0) return;
      if (direction === 1 && index === this.boardList.length - 1) return;
      
      const newIndex = index + direction;
      const temp = this.boardList[index];
      this.boardList[index] = this.boardList[newIndex];
      this.boardList[newIndex] = temp;
      
      // order 속성 업데이트
      this.boardList.forEach((board, i) => board.order = i + 1);
      
      // TODO: Firestore에 저장
      this.saveBoardOrder();
    },
    
    async saveBoardOrder() {
      try {
        // 게시판 설정 저장 (Firestore 'settings/boards' 문서)
        await updateDoc(doc(db, 'settings', 'boards'), {
          boardList: this.boardList,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        console.log('Board order saved locally (Firestore update pending)');
      }
    },
    
    // 새 게시판 모달 열기
    openNewBoardModal() {
      this.boardForm = { id: null, name: '', icon: '📋', isActive: true };
      this.showBoardModal = true;
    },
    
    // 게시판 수정 모달 열기
    editBoard(board) {
      this.boardForm = { ...board };
      this.showBoardModal = true;
    },
    
    // 게시판 저장 (추가/수정)
    async saveBoard() {
      if (!this.boardForm.name.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '게시판명을 입력하세요',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      const boardId = this.boardForm.id || this.boardForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      
      if (this.boardForm.id) {
        // 수정
        const index = this.boardList.findIndex(b => b.id === this.boardForm.id);
        if (index !== -1) {
          this.boardList[index] = { ...this.boardForm };
        }
      } else {
        // 추가
        if (this.boardList.find(b => b.id === boardId)) {
          Swal.fire({
            icon: 'error',
            title: '중복된 ID',
            text: '동일한 ID의 게시판이 이미 존재합니다.',
            confirmButtonColor: '#2563eb'
          });
          return;
        }
        
        this.boardList.push({
          id: boardId,
          name: this.boardForm.name.trim(),
          icon: this.boardForm.icon,
          isActive: this.boardForm.isActive,
          isDefault: false,
          order: this.boardList.length + 1
        });
      }
      
      this.showBoardModal = false;
      this.saveBoardOrder();
      
      Swal.fire({
        icon: 'success',
        title: this.boardForm.id ? '수정 완료' : '추가 완료',
        timer: 1200,
        showConfirmButton: false
      });
    },
    
    // 게시판 상태 토글
    async toggleBoardStatus(boardId, isActive) {
      const board = this.boardList.find(b => b.id === boardId);
      if (!board) return;
      
      if (board.isDefault && !isActive) {
        Swal.fire({
          icon: 'warning',
          title: '기본 게시판',
          text: '기본 게시판은 비활성화할 수 없습니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      board.isActive = isActive;
      this.saveBoardOrder();
      
      Swal.fire({
        icon: 'success',
        title: isActive ? '활성화 완료' : '비활성화 완료',
        timer: 1000,
        showConfirmButton: false
      });
    },
    
    // 게시판 삭제
    async deleteBoard(boardId) {
      const board = this.boardList.find(b => b.id === boardId);
      if (board?.isDefault) {
        Swal.fire({
          icon: 'error',
          title: '삭제 불가',
          text: '기본 게시판은 삭제할 수 없습니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      const result = await Swal.fire({
        icon: 'warning',
        title: '게시판을 삭제하시겠습니까?',
        text: '해당 게시판의 모든 글도 함께 삭제됩니다.',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });
      
      if (!result.isConfirmed) return;
      
      this.boardList = this.boardList.filter(b => b.id !== boardId);
      this.saveBoardOrder();

      Swal.fire({
        icon: 'success',
        title: '삭제 완료',
        timer: 1200,
        showConfirmButton: false
      });
    },

    // ========== INQUIRY MANAGEMENT ==========

    // Load inquiries for admin (all inquiries)
    async loadInquiries() {
      console.log('Loading inquiries for admin...');

      // Admin sees all inquiries - no filter
      const q = query(
        collection(db, 'inquiries'),
        orderBy('createdAt', 'desc'),
        limit(100)
      );

      onSnapshot(q, (snapshot) => {
        this.inquiries = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        this.updateInquiryStats();
        console.log('Loaded', this.inquiries.length, 'inquiries for admin');
      }, (error) => {
        console.error('Error loading inquiries:', error);
        // Fallback without orderBy if index doesn't exist
        if (error.message?.includes('index')) {
          const fallbackQuery = query(
            collection(db, 'inquiries'),
            limit(100)
          );
          onSnapshot(fallbackQuery, (snapshot) => {
            this.inquiries = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })).sort((a, b) => {
              const aTime = a.createdAt?.toMillis?.() || a.created_at?.toMillis?.() || 0;
              const bTime = b.createdAt?.toMillis?.() || b.created_at?.toMillis?.() || 0;
              return bTime - aTime;
            });
            this.updateInquiryStats();
          });
        }
      });
    },

    // Update inquiry stats
    updateInquiryStats() {
      if (!this.inquiries) return;
      this.inquiryStats.pending = this.inquiries.filter(i => i.status === 'pending').length;
      this.inquiryStats.responded = this.inquiries.filter(i => i.status === 'responded' || i.status === 'answered').length;
      this.inquiryStats.closed = this.inquiries.filter(i => i.status === 'closed').length;
    },

    // Computed filtered inquiries
    get filteredInquiries() {
      if (this.inquiryFilter === 'all') return this.inquiries;
      if (this.inquiryFilter === 'responded') {
        return this.inquiries.filter(i => i.status === 'responded' || i.status === 'answered');
      }
      return this.inquiries.filter(i => i.status === this.inquiryFilter);
    },

    // Get inquiry status text
    getInquiryStatusText(status) {
      const statusMap = {
        pending: '대기중',
        responded: '답변완료',
        answered: '답변완료',
        closed: '종료됨'
      };
      return statusMap[status] || '대기중';
    },

    // Open inquiry detail modal
    async openInquiry(inquiry) {
      this.selectedInquiry = inquiry;
      this.inquiryResponse = '';
      this.showInquiryModal = true;
      await this.loadInquiryResponses(inquiry.id);
    },

    // Close inquiry modal
    closeInquiryModal() {
      this.showInquiryModal = false;
      this.selectedInquiry = null;
      this.inquiryResponses = [];
      this.inquiryResponse = '';
    },

    // Load inquiry responses
    async loadInquiryResponses(inquiryId) {
      try {
        const q = query(
          collection(db, 'inquiry_responses'),
          where('inquiryId', '==', inquiryId),
          orderBy('createdAt', 'asc')
        );

        onSnapshot(q, (snapshot) => {
          this.inquiryResponses = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
        });
      } catch (error) {
        console.error('Error loading inquiry responses:', error);
      }
    },

    // Submit inquiry response
    async submitInquiryResponse() {
      if (!this.inquiryResponse.trim() || !this.selectedInquiry) return;

      this.isSubmitting = true;

      try {
        // Add response
        await addDoc(collection(db, 'inquiry_responses'), {
          inquiryId: this.selectedInquiry.id,
          content: this.inquiryResponse.trim(),
          responderId: this.user.uid,
          responderName: this.user.displayName || '관리자',
          createdAt: serverTimestamp()
        });

        // Update inquiry status
        await updateDoc(doc(db, 'inquiries', this.selectedInquiry.id), {
          status: 'responded',
          updatedAt: serverTimestamp(),
          responseCount: (this.selectedInquiry.responseCount || 0) + 1
        });

        // Send notification to student
        await addDoc(collection(db, 'notifications'), {
          user_id: this.selectedInquiry.senderId,
          title: '문의에 답변 도착',
          message: `'${this.selectedInquiry.title}'에 대한 답변이 등록되었습니다.`,
          type: 'inquiry_response',
          read: false,
          created_at: serverTimestamp(),
          link: 'contact.html'
        });

        this.inquiryResponse = '';

        Swal.fire({
          icon: 'success',
          title: '답변 등록 완료',
          text: '답변이 성공적으로 등록되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });

      } catch (error) {
        console.error('Error submitting response:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '답변 등록 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isSubmitting = false;
      }
    },

    // Close inquiry (mark as resolved)
    async closeInquiry() {
      if (!this.selectedInquiry) return;

      const result = await Swal.fire({
        icon: 'warning',
        title: '문의를 종료하시겠습니까?',
        text: '종료된 문의는 다시 활성화할 수 없습니다.',
        showCancelButton: true,
        confirmButtonText: '종료',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });

      if (!result.isConfirmed) return;

      try {
        await updateDoc(doc(db, 'inquiries', this.selectedInquiry.id), {
          status: 'closed',
          updatedAt: serverTimestamp()
        });

        this.closeInquiryModal();

        Swal.fire({
          icon: 'success',
          title: '문의 종료',
          text: '문의가 종료되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Error closing inquiry:', error);
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '문의 종료 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    }
  };
};
