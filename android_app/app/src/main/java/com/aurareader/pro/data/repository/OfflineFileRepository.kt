package com.aurareader.pro.data.repository

import com.aurareader.pro.domain.model.UnifiedDocument
import com.aurareader.pro.domain.repository.FileRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import javax.inject.Inject

/**
 * Concrete implementation of the FileRepository.
 * Uses local Android Room DB (mocked here) as the single source of truth,
 * enforcing our offline-first architecture constraint.
 */
class OfflineFileRepository @Inject constructor(
    // private val documentDao: DocumentDao // Room DAO would be injected here
) : FileRepository {

    // Mocking an in-memory data source for demonstration
    private val localDatabase = mutableListOf<UnifiedDocument>()

    override fun getAllDocuments(): Flow<List<UnifiedDocument>> {
        // In a real app, Room returns a Flow directly: return documentDao.getAll()
        return flowOf(localDatabase.toList())
    }

    override suspend fun getDocumentById(id: String): UnifiedDocument? {
        // return documentDao.getById(id)
        return localDatabase.find { it.id == id }
    }

    override suspend fun addDocument(document: UnifiedDocument) {
        // documentDao.insert(document.toEntity())
        localDatabase.add(document)
    }

    override suspend fun deleteDocument(id: String, deleteFile: Boolean) {
        // val doc = documentDao.getById(id)
        // if (deleteFile && doc != null) { File(doc.filePath).delete() }
        // documentDao.deleteById(id)
        localDatabase.removeIf { it.id == id }
    }
}
