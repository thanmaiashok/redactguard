declare module 'piexifjs' {
  type Ifd = Record<number, unknown>;
  const piexif: {
    ImageIFD: Record<
      'Make' | 'Model' | 'Software' | 'Artist' | 'DateTime' | 'ImageDescription' | 'Compression',
      number
    >;
    ExifIFD: Record<
      'DateTimeOriginal' | 'BodySerialNumber' | 'CameraOwnerName' | 'LensModel',
      number
    >;
    GPSIFD: Record<
      | 'GPSLatitudeRef'
      | 'GPSLatitude'
      | 'GPSLongitudeRef'
      | 'GPSLongitude'
      | 'GPSAltitude'
      | 'GPSAltitudeRef',
      number
    >;
    GPSHelper: { degToDmsRational(deg: number): number[][] };
    dump(exif: Record<string, Ifd | string>): string;
    insert(exif: string, jpeg: string): string;
    load(jpeg: string): Record<string, Ifd>;
  };
  export default piexif;
}
