import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

export interface SavedFile {
  id: string;
  url: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  category: string;
  createdAt: Date;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  
  /** 文件存储基础路径 */
  private readonly uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  /** 文件访问基础URL */
  private readonly baseUrl = process.env.BASE_URL || 'http://localhost:8000';

  constructor() {
    // 确保上传目录存在
    const dirs = ['images', 'videos', 'audio', 'references'];
    for (const dir of dirs) {
      const fullPath = path.join(this.uploadDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  /**
   * 从 Buffer 保存文件
   */
  async saveFromBuffer(
    buffer: Buffer,
    originalName: string,
    mimetype: string,
    category: 'image' | 'video' | 'audio' | 'reference' = 'reference',
  ): Promise<SavedFile> {
    const id = uuidv4();
    const ext = path.extname(originalName) || this.extFromMime(mimetype);
    const filename = `${id}${ext}`;
    
    // 根据分类选择子目录
    const categoryDir = category === 'image' ? 'images' : category === 'video' ? 'videos' : category === 'audio' ? 'audio' : 'references';
    const relativePath = path.join(categoryDir, filename);
    const filePath = path.join(this.uploadDir, relativePath);

    // 写入文件
    fs.writeFileSync(filePath, buffer);

    const file: SavedFile = {
      id,
      url: `/files/${relativePath.replace(/\\/g, '/')}`,
      filename,
      originalName,
      mimetype,
      size: buffer.length,
      category,
      createdAt: new Date(),
    };

    this.logger.log(`[FileService] saved ${category}/${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return file;
  }

  /**
   * 获取文件信息（通过ID查找）
   */
  async getFile(id: string): Promise<SavedFile | null> {
    // 遍历子目录查找文件
    const categories = ['images', 'videos', 'audio', 'references'];
    for (const cat of categories) {
      const catDir = path.join(this.uploadDir, cat);
      if (fs.existsSync(catDir)) {
        const files = fs.readdirSync(catDir);
        const match = files.find(f => f.startsWith(id));
        if (match) {
          const filePath = path.join(catDir, match);
          const stat = fs.statSync(filePath);
          return {
            id,
            url: `/files/${cat}/${match}`,
            filename: match,
            originalName: match,
            mimetype: this.mimeFromExt(path.extname(match)),
            size: stat.size,
            category: cat.slice(0, -1), // 去掉复数s
            createdAt: stat.birthtime,
          };
        }
      }
    }
    return null;
  }

  /**
   * 获取文件的本地绝对路径
   */
  getFilePath(url: string): string | null {
    const relativePath = url.replace(/^\/files\//, '');
    const fullPath = path.join(this.uploadDir, relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    return null;
  }

  /**
   * 删除文件
   */
  async deleteFile(id: string): Promise<boolean> {
    const file = await this.getFile(id);
    if (!file) return false;

    try {
      const relativePath = file.url.replace(/^\/files\//, '');
      const fullPath = path.join(this.uploadDir, relativePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return true;
      }
    } catch (e) {
      this.logger.warn(`[FileService] delete ${id} failed:`, e);
    }
    return false;
  }

  /* ========== 工具方法 ========== */

  private extFromMime(mimetype: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
    };
    return map[mimetype] || '.bin';
  }

  private mimeFromExt(ext: string): string {
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
  }
}
