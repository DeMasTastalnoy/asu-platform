export interface Course {
  id: number;
  title: string;
  description: string;
  instructor_name: string;
  status: 'draft' | 'published' | 'archived';
  level: number;
  cover_image: string;
  modules_count: number;
  progress?: number | null;
  prerequisite?: number | null;
  prerequisite_title?: string | null;
  locked?: boolean;
  created_at: string;
}

export interface CourseModule {
  id: number;
  title: string;
  type: 'lecture' | 'video' | 'document' | 'test' | 'simulation';
  content: string;
  file_url: string;
  order_num: number;
  is_required: boolean;
  progress?: {
    status: 'not_started' | 'in_progress' | 'completed';
    time_spent_sec: number;
  };
}

export interface Enrollment {
  id: number;
  course: number;
  course_title: string;
  student: number;
  student_name: string;
  status: 'active' | 'completed' | 'dropped';
  deadline: string | null;
  progress: number;
  enrolled_at: string;
}
